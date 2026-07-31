// Nguồn duy nhất để đọc + so khớp ADMIN_API_KEY. Dùng chung bởi adminAuthPlugin
// (guard /admin/*) và tenantAuthPlugin (admin key làm super key cho /english/*).

// Đọc admin secret từ header 'x-admin-key' hoặc 'Authorization: Bearer'.
export function extractAdminKey(headers: Record<string, string | undefined>): string | null {
  const headerKey = headers['x-admin-key'];
  if (headerKey) return headerKey;
  const auth = headers.authorization;
  if (auth) {
    const [scheme, token] = auth.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  return null;
}

// So khớp với ADMIN_API_KEY. Trả false (không throw) nếu raw rỗng hoặc env chưa
// cấu hình — caller tự quyết định phản hồi.
export function isAdminKey(raw: string | null): boolean {
  if (!raw) return false;
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  return raw === expected;
}
