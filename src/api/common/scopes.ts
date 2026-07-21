// Danh mục scope tenant tập trung. Route khai báo qua `auth: { scope: SCOPES.X }`
// thay vì string literal rải rác. Xem docs/tenant-auth.md (bảng scope→route).
export const SCOPES = {
  QUIZ_READ: 'quiz:read',
  POOL_FILL: 'pool:fill',
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',
  TOPIC_WRITE: 'topic:write',
  CRON_READ: 'cron:read'
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
