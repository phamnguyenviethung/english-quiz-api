import { sql } from 'drizzle-orm';
import db from '@/configs/orm.config';
import { ensureEnglishConfigSeeded, refreshEnglishConfig } from '@/core/services/english/englishConfig.service';

/**
 * Dọn DB test giữa các case.
 *
 * Hai bảng config (`english_config_record_types`, `english_config_records`) KHÔNG bị truncate:
 * chúng là bảng seed metadata (~60 row, mỗi row 1 select + 1 insert khi seed lại). Thay vì
 * seed lại mỗi case, chỉ copy cột default* → value* bằng 1 UPDATE rồi refresh snapshot —
 * cho đúng trạng thái "config mặc định" mà rẻ hơn nhiều.
 */

const PRESERVED_TABLES = new Set(['__drizzle_migrations', 'english_config_record_types', 'english_config_records']);

let tableCache: string[] | null = null;
let seeded = false;

/** Đọc danh sách bảng từ information_schema thay vì hardcode — thêm bảng mới không phải sửa đây. */
async function listTruncatableTables(): Promise<string[]> {
  if (tableCache) return tableCache;
  const result = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const names = (result.rows as Array<{ tablename: string }>).map((row) => row.tablename);
  const truncatable = names.filter((name) => !PRESERVED_TABLES.has(name));
  tableCache = truncatable;
  return truncatable;
}

/** Gọi 1 lần trước cả suite: đảm bảo bảng config đã có đủ record definition. */
export async function ensureTestDbReady(): Promise<void> {
  if (seeded) return;
  await ensureEnglishConfigSeeded();
  seeded = true;
}

/** Đưa mọi giá trị config về đúng default đã khai trong englishConfig.defaults.ts. */
export async function resetEnglishConfig(): Promise<void> {
  await db.execute(sql`
    UPDATE english_config_records
    SET "valueText" = "defaultText",
        "valueNumber" = "defaultNumber",
        "valueBoolean" = "defaultBoolean",
        "valueJson" = "defaultJson"
  `);
  await refreshEnglishConfig();
}

/**
 * Xoá sạch dữ liệu nghiệp vụ + đưa config về default. Dùng trong `beforeEach` của
 * integration/e2e. CASCADE lo thứ tự FK nên không cần liệt kê tay.
 */
export async function resetDb(): Promise<void> {
  await ensureTestDbReady();
  const tables = await listTruncatableTables();
  if (tables.length > 0) {
    const list = tables.map((name) => `"${name}"`).join(', ');
    await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  }
  await resetEnglishConfig();
}

/** Đếm row của 1 bảng — tiện cho assert kiểu "pop không xoá row". */
export async function countRows(table: string): Promise<number> {
  const res = await db.execute(sql.raw(`SELECT count(*)::text AS count FROM "${table}"`));
  const row = (res.rows as Array<{ count: string }>)[0];
  return Number(row?.count ?? 0);
}
