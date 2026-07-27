// Sanitize spec OpenAPI do @elysiajs/openapi sinh ra để hợp lệ chuẩn OpenAPI 3.1 /
// JSON Schema 2020-12. Converter của lib (TypeBox + z.toJSONSchema) phát sinh vài cú
// pháp không hợp lệ mà không thể sửa từ phía schema route:
//
//   1. `nullable: true` đứng cạnh anyOf/[type:null] — `nullable` bị bỏ ở 3.1 (dùng
//      type:"null" thay thế), nên field này luôn thừa và sai.
//   2. Union của numeric literal (t.Union([t.Literal(3),...])) emit { type:"string",
//      enum:[3,4,5] } — type sai (phải suy ra từ giá trị enum).
//   3. t.Tuple emit cú pháp 3.0 { type:"array", items:[...], additionalItems } — 3.1
//      dùng prefixItems cho tuple.
//   4. t.Date() emit { type:"Date" } — không phải type JSON Schema hợp lệ. Trên wire Date
//      serialize thành ISO string nên rewrite sang { type:"string", format:"date-time" }.
//      (Dùng t.Date() thay vì t.Unsafe vì t.Unsafe làm TypeBox response compiler throw.)
//
// Hàm này chạy đệ quy trên object spec đã parse, sửa tại chỗ (mutate) rồi trả về.

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

// Suy ra type JSON Schema từ 1 giá trị enum (dùng khi type bị gán sai).
function inferType(value: unknown): string | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (value === null) return 'null';
  return null;
}

function sanitizeNode(node: JsonValue): void {
  if (Array.isArray(node)) {
    for (const item of node) sanitizeNode(item as JsonValue);
    return;
  }
  if (!isRecord(node)) return;

  // (1) Bỏ `nullable` — không hợp lệ ở OpenAPI 3.1. Nullability đã được biểu diễn bằng
  // anyOf/[{type:"null"}] mà converter sinh kèm, nên chỉ cần drop field thừa này.
  if ('nullable' in node) delete node.nullable;

  // (4) t.Date() → type:"Date" (không hợp lệ). Rewrite sang string/date-time (shape thật
  // trên wire). Xoá luôn các option timestamp riêng của TypeBox Date nếu có (không thuộc
  // JSON Schema): minimumTimestamp/maximumTimestamp/...
  if (node.type === 'Date') {
    node.type = 'string';
    node.format = 'date-time';
    for (const k of [
      'minimumTimestamp',
      'maximumTimestamp',
      'exclusiveMinimumTimestamp',
      'exclusiveMaximumTimestamp',
      'multipleOfTimestamp'
    ]) {
      if (k in node) delete node[k];
    }
  }

  // (2) Union numeric-literal: type bị gán "string" nhưng enum toàn số. Sửa type theo
  // giá trị enum thực tế (nếu enum đồng nhất kiểu và lệch với type hiện tại).
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const inferred = inferType(node.enum[0]);
    const allSame = inferred !== null && node.enum.every((v) => inferType(v) === inferred);
    if (allSame && typeof node.type === 'string' && node.type !== inferred) {
      node.type = inferred;
    }
  }

  // (3) t.Tuple: { type:"array", items:[schemaA, schemaB], additionalItems } (cú pháp 3.0)
  // → 3.1 { type:"array", prefixItems:[schemaA, schemaB] }. Chỉ áp dụng khi items là mảng.
  if (node.type === 'array' && Array.isArray(node.items)) {
    node.prefixItems = node.items;
    delete node.items;
    if ('additionalItems' in node) delete node.additionalItems;
  }

  // Đệ quy vào mọi property con.
  for (const value of Object.values(node)) {
    if (isRecord(value) || Array.isArray(value)) sanitizeNode(value as JsonValue);
  }
}

// Nhận spec đã build, trả về BẢN SAO đã sửa. QUAN TRỌNG: phải deep-clone trước khi mutate
// — object spec do @elysiajs/openapi trả về DÙNG CHUNG reference schema với validator
// runtime của từng route. Nếu sửa in-place, ta phá luôn schema mà Elysia dùng để validate
// response, khiến các route (compile lazy sau lần fetch spec đầu tiên) throw
// TypeCompilerTypeGuardError → 500. structuredClone cắt đứt mọi shared reference.
export function sanitizeOpenApiSpec<T extends Record<string, unknown>>(spec: T): T {
  const cloned = structuredClone(spec);
  sanitizeNode(cloned as JsonValue);
  return cloned;
}
