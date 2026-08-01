import { asc, eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { BusinessLogicException } from '@/core/exceptions';
import {
  englishConfigRecord,
  englishConfigRecordType,
  type EnglishConfigRecord,
  type EnglishConfigRecordType
} from '@/core/db/schema/main';
import {
  buildDefaultEnglishConfigSnapshot,
  CONFIG_RECORD_TYPES,
  ENGLISH_CONFIG_RECORD_DEFINITIONS,
  ENGLISH_CONFIG_RECORD_TYPES,
  EnglishConfigDefaults,
  EnglishConfigSchemas,
  type EnglishConfigFieldSchema,
  type EnglishConfigKey,
  type EnglishConfigRecordDefinition,
  type EnglishConfigRecordTypeKey,
  type EnglishConfigSnapshot
} from './englishConfig.defaults';

export type EnglishConfigRecordView = EnglishConfigRecord & {
  recordType: EnglishConfigRecordTypeKey;
  value: unknown;
  defaultValue: unknown;
};

const definitionByRecordKey = new Map(ENGLISH_CONFIG_RECORD_DEFINITIONS.map((def) => [def.recordKey, def]));

let snapshot: EnglishConfigSnapshot = buildDefaultEnglishConfigSnapshot();
let hasLoadedFromDb = false;

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecordType(value: string): asserts value is EnglishConfigRecordTypeKey {
  if (!(CONFIG_RECORD_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown English config record type: ${value}`);
  }
}

function readValueForType(row: EnglishConfigRecord, recordType: EnglishConfigRecordTypeKey): unknown {
  if (recordType === 'str') return row.valueText;
  if (recordType === 'num') return row.valueNumber;
  if (recordType === 'boolean') return row.valueBoolean;
  return row.valueJson;
}

function readDefaultForType(row: EnglishConfigRecord, recordType: EnglishConfigRecordTypeKey): unknown {
  if (recordType === 'str') return row.defaultText;
  if (recordType === 'num') return row.defaultNumber;
  if (recordType === 'boolean') return row.defaultBoolean;
  return row.defaultJson;
}

function valueColumnsForType(recordType: EnglishConfigRecordTypeKey, value: unknown, prefix: 'value' | 'default') {
  const columns =
    prefix === 'value'
      ? { valueText: null, valueNumber: null, valueBoolean: null, valueJson: null }
      : { defaultText: null, defaultNumber: null, defaultBoolean: null, defaultJson: null };

  if (recordType === 'str') return { ...columns, [`${prefix}Text`]: String(value ?? '') };
  if (recordType === 'num') return { ...columns, [`${prefix}Number`]: Number(value) };
  if (recordType === 'boolean') return { ...columns, [`${prefix}Boolean`]: Boolean(value) };
  return { ...columns, [`${prefix}Json`]: value };
}

function validateBasicValue(
  recordType: EnglishConfigRecordTypeKey,
  value: unknown,
  schema: EnglishConfigFieldSchema
): unknown {
  if (recordType === 'str') {
    if (typeof value !== 'string') throw new Error('Value must be a string');
    if (schema.options?.length && !schema.options.includes(value))
      throw new Error(`Value must be one of: ${schema.options.join(', ')}`);
    if (schema.min !== undefined && value.length < schema.min)
      throw new Error(`String length must be >= ${schema.min}`);
    if (schema.max !== undefined && value.length > schema.max)
      throw new Error(`String length must be <= ${schema.max}`);
    return value;
  }

  if (recordType === 'num') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Value must be a valid number');
    if (schema.integer && !Number.isInteger(value)) throw new Error('Value must be an integer');
    if (schema.min !== undefined && value < schema.min) throw new Error(`Value must be >= ${schema.min}`);
    if (schema.max !== undefined && value > schema.max) throw new Error(`Value must be <= ${schema.max}`);
    return value;
  }

  if (recordType === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('Value must be a boolean');
    return value;
  }

  if (recordType === 'arr') {
    if (!Array.isArray(value)) throw new Error('Value must be an array');
    if (schema.min !== undefined && value.length < schema.min) throw new Error(`Array length must be >= ${schema.min}`);
    if (schema.max !== undefined && value.length > schema.max) throw new Error(`Array length must be <= ${schema.max}`);
    return value;
  }

  if (!isPlainObject(value)) throw new Error('Value must be an object');
  return value;
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (path === 'items') {
    Object.assign(target, { __rootArray: value });
    return;
  }

  const parts = path.split('.').filter(Boolean);
  let current = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function applyRecordValue(raw: EnglishConfigSnapshot, def: EnglishConfigRecordDefinition, value: unknown): void {
  if (def.namespace === 'quiz_distribution' && def.path === 'items') {
    raw.quiz_distribution = value as EnglishConfigSnapshot['quiz_distribution'];
    return;
  }
  if (def.namespace === 'pool_refill_schedule' && def.path === 'items') {
    raw.pool_refill_schedule = value as EnglishConfigSnapshot['pool_refill_schedule'];
    return;
  }

  const namespaceValue = raw[def.namespace];
  if (!isPlainObject(namespaceValue)) return;
  assignPath(namespaceValue, def.path, value);
}

function parseSnapshotNamespace(namespace: EnglishConfigKey, value: unknown): EnglishConfigSnapshot[EnglishConfigKey] {
  return EnglishConfigSchemas[namespace].parse(value) as EnglishConfigSnapshot[EnglishConfigKey];
}

function buildSnapshotFromRows(
  rows: EnglishConfigRecordView[],
  strictNamespace?: EnglishConfigKey
): EnglishConfigSnapshot {
  const next = buildDefaultEnglishConfigSnapshot();

  for (const row of rows) {
    const def = definitionByRecordKey.get(row.recordKey);
    if (!def) continue;

    try {
      const value = validateBasicValue(row.recordType, row.value, def.validation);
      applyRecordValue(next, def, value);
    } catch (err) {
      if (strictNamespace === def.namespace) throw err;
      logger.warn(`[EnglishConfig] Invalid DB value for recordKey=${row.recordKey}, using default. err=${err}`);
    }
  }

  for (const key of Object.keys(EnglishConfigDefaults) as EnglishConfigKey[]) {
    try {
      next[key] = parseSnapshotNamespace(key, next[key]) as never;
    } catch (err) {
      if (strictNamespace === key) throw err;
      logger.warn(`[EnglishConfig] Invalid DB snapshot namespace=${key}, using default. err=${err}`);
      next[key] = buildDefaultEnglishConfigSnapshot()[key] as never;
    }
  }

  return next;
}

async function getRecordTypeRows(): Promise<EnglishConfigRecordType[]> {
  return db.select().from(englishConfigRecordType);
}

async function enrichRows(rows: EnglishConfigRecord[]): Promise<EnglishConfigRecordView[]> {
  const types = await getRecordTypeRows();
  const typeById = new Map(types.map((type) => [type.id, type.key]));

  return rows.map((row) => {
    const recordType = typeById.get(row.recordTypeId);
    if (!recordType) throw new Error(`Missing English config record type id=${row.recordTypeId}`);
    assertRecordType(recordType);
    return {
      ...row,
      recordType,
      value: readValueForType(row, recordType),
      defaultValue: readDefaultForType(row, recordType)
    };
  });
}

export function getEnglishConfigSnapshot(): EnglishConfigSnapshot {
  return snapshot;
}

export function hasEnglishConfigLoadedFromDb(): boolean {
  return hasLoadedFromDb;
}

export async function getAllEnglishConfigRows(): Promise<EnglishConfigRecordView[]> {
  const rows = await db
    .select()
    .from(englishConfigRecord)
    .orderBy(asc(englishConfigRecord.category), asc(englishConfigRecord.sortOrder));
  return enrichRows(rows);
}

export async function getEnglishConfigByKey(recordKey: string): Promise<EnglishConfigRecordView | null> {
  const [row] = await db
    .select()
    .from(englishConfigRecord)
    .where(eq(englishConfigRecord.recordKey, recordKey))
    .limit(1);
  if (!row) return null;
  const [view] = await enrichRows([row]);
  return view ?? null;
}

export async function ensureEnglishConfigSeeded(): Promise<void> {
  await db.transaction(async (tx) => {
    for (const def of ENGLISH_CONFIG_RECORD_TYPES) {
      await tx
        .insert(englishConfigRecordType)
        .values(def)
        .onConflictDoUpdate({
          target: englishConfigRecordType.key,
          set: {
            label: def.label,
            description: def.description,
            sortOrder: def.sortOrder,
            updatedAt: new Date()
          }
        });
    }

    const typeRows = await tx.select().from(englishConfigRecordType);
    const typeIdByKey = new Map(typeRows.map((row) => [row.key, row.id]));

    for (const def of ENGLISH_CONFIG_RECORD_DEFINITIONS) {
      const recordTypeId = typeIdByKey.get(def.recordType);
      if (!recordTypeId) throw new Error(`English config record type not seeded: ${def.recordType}`);

      const [existing] = await tx
        .select()
        .from(englishConfigRecord)
        .where(eq(englishConfigRecord.recordKey, def.recordKey))
        .limit(1);

      const defaultColumns = valueColumnsForType(def.recordType, def.defaultValue, 'default');
      const metadata = {
        namespace: def.namespace,
        path: def.path,
        category: def.category,
        label: def.label,
        description: def.description,
        recordTypeId,
        validation: def.validation,
        uiSchema: def.uiSchema,
        sortOrder: def.sortOrder
      };

      if (!existing) {
        await tx.insert(englishConfigRecord).values({
          recordKey: def.recordKey,
          ...metadata,
          ...valueColumnsForType(def.recordType, def.defaultValue, 'value'),
          ...defaultColumns
        });
        continue;
      }

      const metadataChanged =
        existing.namespace !== def.namespace ||
        existing.path !== def.path ||
        existing.category !== def.category ||
        existing.label !== def.label ||
        existing.description !== def.description ||
        existing.recordTypeId !== recordTypeId ||
        existing.sortOrder !== def.sortOrder ||
        !jsonEqual(existing.validation, def.validation) ||
        !jsonEqual(existing.uiSchema, def.uiSchema) ||
        !jsonEqual(readDefaultForType(existing, def.recordType), def.defaultValue);

      if (!metadataChanged) continue;

      await tx
        .update(englishConfigRecord)
        .set({
          ...metadata,
          ...defaultColumns,
          updatedAt: new Date()
        })
        .where(eq(englishConfigRecord.id, existing.id));
    }
  });

  await refreshEnglishConfig();
}

export async function refreshEnglishConfig(): Promise<EnglishConfigSnapshot> {
  const rows = await getAllEnglishConfigRows();
  snapshot = buildSnapshotFromRows(rows);
  hasLoadedFromDb = true;
  logger.info(`[EnglishConfig] Loaded ${rows.length} config record(s)`);
  return snapshot;
}

export function parseEnglishConfigValue(recordKey: string, value: unknown): unknown {
  const def = definitionByRecordKey.get(recordKey);
  if (!def) throw new BusinessLogicException(`Unknown English config record key: ${recordKey}`);
  try {
    return validateBasicValue(def.recordType, value, def.validation);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BusinessLogicException(`Invalid value for ${recordKey}: ${message}`);
  }
}

export async function updateEnglishConfig(recordKey: string, value: unknown): Promise<EnglishConfigRecordView> {
  const def = definitionByRecordKey.get(recordKey);
  if (!def) throw new BusinessLogicException(`Unknown English config record key: ${recordKey}`);

  const parsedValue = parseEnglishConfigValue(recordKey, value);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(englishConfigRecord)
      .where(eq(englishConfigRecord.recordKey, recordKey))
      .limit(1)
      .for('update');
    if (!row) throw new Error(`English config record not found: ${recordKey}`);

    const rows = await tx.select().from(englishConfigRecord);
    const typeRows = await tx.select().from(englishConfigRecordType);
    const typeById = new Map(typeRows.map((typeRow) => [typeRow.id, typeRow.key]));
    const nextRows = rows.map((candidate) => {
      const recordType = typeById.get(candidate.recordTypeId);
      if (!recordType) throw new Error(`Missing English config record type id=${candidate.recordTypeId}`);
      assertRecordType(recordType);
      const nextCandidate =
        candidate.id === row.id
          ? ({
              ...candidate,
              ...valueColumnsForType(def.recordType, parsedValue, 'value')
            } as EnglishConfigRecord)
          : candidate;
      return {
        ...nextCandidate,
        recordType,
        value: readValueForType(nextCandidate, recordType),
        defaultValue: readDefaultForType(nextCandidate, recordType)
      };
    });

    try {
      buildSnapshotFromRows(nextRows, def.namespace);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BusinessLogicException(`Invalid value for ${recordKey}: ${message}`);
    }

    const [nextRow] = await tx
      .update(englishConfigRecord)
      .set({ ...valueColumnsForType(def.recordType, parsedValue, 'value'), updatedAt: new Date() })
      .where(eq(englishConfigRecord.id, row.id))
      .returning();
    if (!nextRow) throw new Error(`Failed to update English config record: ${recordKey}`);
    return nextRow;
  });

  await refreshEnglishConfig();
  logger.info(`[EnglishConfig] Updated recordKey=${recordKey}`);
  await runEnglishConfigChangeHooks(recordKey, parsedValue);
  const [view] = await enrichRows([updated]);
  if (!view) throw new Error(`Failed to load updated English config record: ${recordKey}`);
  return view;
}

export async function resetEnglishConfigToDefault(recordKey: string): Promise<EnglishConfigRecordView> {
  const def = definitionByRecordKey.get(recordKey);
  if (!def) throw new BusinessLogicException(`Unknown English config record key: ${recordKey}`);
  return updateEnglishConfig(recordKey, def.defaultValue);
}

// Cho phép các module khác (vd BullMQ scheduler) phản ứng khi 1 recordKey cụ thể
// đổi giá trị, mà không cần englishConfig.service.ts biết về BullMQ/queue nào cả.
type ConfigChangeHook = (newValue: unknown) => Promise<void> | void;
const changeHooks = new Map<string, ConfigChangeHook[]>();

export function onEnglishConfigChanged(recordKey: string, hook: ConfigChangeHook): void {
  const hooks = changeHooks.get(recordKey) ?? [];
  hooks.push(hook);
  changeHooks.set(recordKey, hooks);
}

async function runEnglishConfigChangeHooks(recordKey: string, newValue: unknown): Promise<void> {
  const hooks = changeHooks.get(recordKey);
  if (!hooks || hooks.length === 0) return;
  for (const hook of hooks) {
    try {
      await hook(newValue);
    } catch (err) {
      logger.warn(`[EnglishConfig] Change hook failed for recordKey=${recordKey}: ${err}`);
    }
  }
}

export function isEnglishConfigKey(value: string): boolean {
  return definitionByRecordKey.has(value);
}

export default {
  ensureEnglishConfigSeeded,
  getAllEnglishConfigRows,
  getEnglishConfigByKey,
  getEnglishConfigSnapshot,
  hasEnglishConfigLoadedFromDb,
  isEnglishConfigKey,
  onEnglishConfigChanged,
  parseEnglishConfigValue,
  refreshEnglishConfig,
  resetEnglishConfigToDefault,
  updateEnglishConfig
};
