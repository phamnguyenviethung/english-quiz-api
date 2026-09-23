import {
  MODEL_QUANTIZATIONS,
  PROVIDER_PREF_VALUE_KINDS,
  type AiModelProviderPref,
  type AiModelProviderPrefValue,
  type ModelQuantization,
  type ProviderPreferencesJson,
  type ProviderPrefValueKind
} from '@/core/db/schema/main';
import { BusinessLogicException } from '@/core/exceptions';

// Cầu nối giữa 2 bảng normalize (ai_model_provider_prefs + ..._values) và object
// ProviderPreferencesJson mà OpenRouter SDK nhận. Mọi chuyện đổi kiểu (maxPrice
// number↔string) và validate enum đều tập trung ở đây — service chỉ gọi 2 hàm.

export interface ProviderPrefColumns {
  allowFallbacks: boolean | null;
  requireParameters: boolean | null;
  dataCollection: string | null;
  sort: string | null;
  zdr: boolean | null;
  maxPricePrompt: number | null;
  maxPriceCompletion: number | null;
  maxPriceRequest: number | null;
  maxPriceImage: number | null;
  maxPriceAudio: number | null;
}

export interface ProviderPrefValueInput {
  kind: ProviderPrefValueKind;
  value: string;
  position: number;
}

const MAX_PRICE_COLUMNS = {
  prompt: 'maxPricePrompt',
  completion: 'maxPriceCompletion',
  request: 'maxPriceRequest',
  image: 'maxPriceImage',
  audio: 'maxPriceAudio'
} as const;

type MaxPriceKey = keyof typeof MAX_PRICE_COLUMNS;

function isQuantization(value: string): value is ModelQuantization {
  return (MODEL_QUANTIZATIONS as readonly string[]).includes(value);
}

type ProviderPrefValueRow = Pick<AiModelProviderPrefValue, 'id' | 'kind' | 'value' | 'position'>;

function collectValues(values: ProviderPrefValueRow[], kind: ProviderPrefValueKind): string[] {
  return values
    .filter((row) => row.kind === kind)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((row) => row.value);
}

/**
 * Rows → object cho chatRequest.provider. Trả `undefined` khi model chưa cấu hình gì,
 * khớp đúng chỗ caller đang truyền `?? undefined` vào ResolvedStudyModel.provider.
 */
export function toProviderPreferences(
  pref: Pick<AiModelProviderPref, keyof ProviderPrefColumns> | null | undefined,
  values: ProviderPrefValueRow[] = []
): ProviderPreferencesJson | undefined {
  if (!pref) return undefined;

  const result: ProviderPreferencesJson = {};

  if (pref.allowFallbacks !== null) result.allowFallbacks = pref.allowFallbacks;
  if (pref.requireParameters !== null) result.requireParameters = pref.requireParameters;
  if (pref.dataCollection === 'allow' || pref.dataCollection === 'deny') result.dataCollection = pref.dataCollection;
  if (pref.sort !== null) result.sort = pref.sort;
  if (pref.zdr !== null) result.zdr = pref.zdr;

  const order = collectValues(values, 'order');
  const ignore = collectValues(values, 'ignore');
  const only = collectValues(values, 'only');
  const quantizations = collectValues(values, 'quantization').filter(isQuantization);

  if (order.length > 0) result.order = order;
  if (ignore.length > 0) result.ignore = ignore;
  if (only.length > 0) result.only = only;
  if (quantizations.length > 0) result.quantizations = quantizations;

  const maxPrice: NonNullable<ProviderPreferencesJson['maxPrice']> = {};
  for (const [key, column] of Object.entries(MAX_PRICE_COLUMNS) as [MaxPriceKey, keyof ProviderPrefColumns][]) {
    const raw = pref[column];
    if (typeof raw === 'number') maxPrice[key] = String(raw);
  }
  if (Object.keys(maxPrice).length > 0) result.maxPrice = maxPrice;

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseMaxPrice(key: MaxPriceKey, raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BusinessLogicException(`maxPrice.${key} phải là số không âm, nhận được: "${raw}"`);
  }
  return parsed;
}

function assertProviderList(field: string, list: string[] | undefined): string[] {
  if (!list) return [];
  const cleaned = list.map((item) => item.trim()).filter((item) => item.length > 0);
  if (new Set(cleaned).size !== cleaned.length) {
    throw new BusinessLogicException(`${field} có phần tử trùng lặp`);
  }
  return cleaned;
}

/**
 * Object từ admin API → columns + values để ghi xuống 2 bảng. Throw
 * BusinessLogicException (→ 400) khi giá trị nằm ngoài enum cho phép, thay vì để
 * OpenRouter từ chối giữa lúc sinh nội dung.
 */
export function fromProviderPreferences(input: ProviderPreferencesJson): {
  columns: ProviderPrefColumns;
  values: ProviderPrefValueInput[];
} {
  if (input.dataCollection !== undefined && input.dataCollection !== 'allow' && input.dataCollection !== 'deny') {
    throw new BusinessLogicException(
      `dataCollection phải là "allow" hoặc "deny", nhận được: "${input.dataCollection}"`
    );
  }

  const invalidQuantizations = (input.quantizations ?? []).filter((item) => !isQuantization(item));
  if (invalidQuantizations.length > 0) {
    throw new BusinessLogicException(
      `quantizations không hợp lệ: ${invalidQuantizations.join(', ')} (hợp lệ: ${MODEL_QUANTIZATIONS.join(', ')})`
    );
  }

  const columns: ProviderPrefColumns = {
    allowFallbacks: input.allowFallbacks ?? null,
    requireParameters: input.requireParameters ?? null,
    dataCollection: input.dataCollection ?? null,
    sort: input.sort?.trim() || null,
    zdr: input.zdr ?? null,
    maxPricePrompt: parseMaxPrice('prompt', input.maxPrice?.prompt),
    maxPriceCompletion: parseMaxPrice('completion', input.maxPrice?.completion),
    maxPriceRequest: parseMaxPrice('request', input.maxPrice?.request),
    maxPriceImage: parseMaxPrice('image', input.maxPrice?.image),
    maxPriceAudio: parseMaxPrice('audio', input.maxPrice?.audio)
  };

  const listsByKind: Record<ProviderPrefValueKind, string[]> = {
    order: assertProviderList('order', input.order),
    ignore: assertProviderList('ignore', input.ignore),
    only: assertProviderList('only', input.only),
    quantization: assertProviderList('quantizations', input.quantizations)
  };

  const values: ProviderPrefValueInput[] = [];
  for (const kind of PROVIDER_PREF_VALUE_KINDS) {
    listsByKind[kind].forEach((value, index) => values.push({ kind, value, position: index }));
  }

  return { columns, values };
}

/** Không field nào có giá trị → không cần giữ row nào trong DB. */
export function isEmptyProviderPreferences(columns: ProviderPrefColumns, values: ProviderPrefValueInput[]): boolean {
  return values.length === 0 && Object.values(columns).every((value) => value === null);
}

/**
 * Validate + chuẩn hoá provider prefs lưu dạng jsonb (context schedule/manual) bằng đúng rule
 * của context reading: đi qua fromProviderPreferences rồi dựng lại object. Giá trị sai → 400
 * ngay lúc lưu thay vì để OpenRouter từ chối ở mọi lần sinh câu hỏi. Rỗng → null.
 */
export function normalizeProviderPreferencesJson(
  input: ProviderPreferencesJson | null | undefined
): ProviderPreferencesJson | null {
  if (!input) return null;
  const { columns, values } = fromProviderPreferences(input);
  if (isEmptyProviderPreferences(columns, values)) return null;
  const rows = values.map((value, index) => ({ ...value, id: index }));
  return toProviderPreferences(columns, rows) ?? null;
}
