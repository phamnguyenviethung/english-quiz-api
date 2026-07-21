import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------------
// English topics
// ----------------------------------------------------------------------------

export const englishTopic = pgTable('english_topics', {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  displayName: text(),
  description: text(),
  isActive: boolean().default(true).notNull(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow()
});

export type EnglishTopic = typeof englishTopic.$inferSelect;
export type InsertEnglishTopic = typeof englishTopic.$inferInsert;

// ----------------------------------------------------------------------------
// Question pool
// ----------------------------------------------------------------------------

export const englishQuestionPool = pgTable('english_question_pool', {
  id: serial().primaryKey(),
  quizType: text().notNull(),
  engLevel: text().notNull(),
  optionCount: integer().notNull(),
  questionData: text().notNull(),
  model: text().notNull(),
  tokenIn: integer().default(0).notNull(),
  tokenOut: integer().default(0).notNull(),
  topicId: integer().references(() => englishTopic.id),
  createdAt: timestamp().defaultNow()
});

export type EnglishQuestionPool = typeof englishQuestionPool.$inferSelect;
export type InsertEnglishQuestionPool = typeof englishQuestionPool.$inferInsert;

// ----------------------------------------------------------------------------
// Cron job tracking (question generation runs / buckets / model attempts)
// ----------------------------------------------------------------------------

export const englishCronJobRun = pgTable(
  'english_cron_job_runs',
  {
    id: serial().primaryKey(),
    runId: text().notNull().unique(),
    jobKey: text().notNull(),
    trigger: text().notNull(),
    status: text().default('running').notNull(),
    queueName: text(),
    bullJobId: text(),
    bullJobName: text(),
    totalBuckets: integer().default(0).notNull(),
    deficientBuckets: integer().default(0).notNull(),
    succeededBuckets: integer().default(0).notNull(),
    failedBuckets: integer().default(0).notNull(),
    skippedBuckets: integer().default(0).notNull(),
    requestedQuestions: integer().default(0).notNull(),
    generatedQuestions: integer().default(0).notNull(),
    insertedQuestions: integer().default(0).notNull(),
    tokenIn: integer().default(0).notNull(),
    tokenOut: integer().default(0).notNull(),
    errorPhase: text(),
    errorMessage: text(),
    errorStack: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp({ withTimezone: true }),
    durationMs: integer(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [
    index('english_cron_job_runs_job_key_idx').on(t.jobKey),
    index('english_cron_job_runs_status_idx').on(t.status),
    index('english_cron_job_runs_started_at_idx').on(t.startedAt)
  ]
);

export type EnglishCronJobRun = typeof englishCronJobRun.$inferSelect;
export type InsertEnglishCronJobRun = typeof englishCronJobRun.$inferInsert;

export const englishCronJobBucket = pgTable(
  'english_cron_job_buckets',
  {
    id: serial().primaryKey(),
    runRefId: integer()
      .notNull()
      .references(() => englishCronJobRun.id),
    bucketKey: text().notNull(),
    status: text().default('running').notNull(),
    engLevel: text().notNull(),
    quizType: text().notNull(),
    optionCount: integer().notNull(),
    topicId: integer().references(() => englishTopic.id),
    topicName: text(),
    requestedCount: integer().default(0).notNull(),
    generatedCount: integer().default(0).notNull(),
    insertedCount: integer().default(0).notNull(),
    skippedCount: integer().default(0).notNull(),
    tokenIn: integer().default(0).notNull(),
    tokenOut: integer().default(0).notNull(),
    errorPhase: text(),
    errorMessage: text(),
    errorStack: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp({ withTimezone: true }),
    durationMs: integer(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [
    index('english_cron_job_buckets_run_ref_idx').on(t.runRefId),
    index('english_cron_job_buckets_status_idx').on(t.status),
    index('english_cron_job_buckets_bucket_key_idx').on(t.bucketKey)
  ]
);

export type EnglishCronJobBucket = typeof englishCronJobBucket.$inferSelect;
export type InsertEnglishCronJobBucket = typeof englishCronJobBucket.$inferInsert;

export const englishCronJobModelAttempt = pgTable(
  'english_cron_job_model_attempts',
  {
    id: serial().primaryKey(),
    runRefId: integer()
      .notNull()
      .references(() => englishCronJobRun.id),
    bucketRefId: integer()
      .notNull()
      .references(() => englishCronJobBucket.id),
    model: text().notNull(),
    attemptOrder: integer().notNull(),
    status: text().notNull(),
    requestedCount: integer().default(0).notNull(),
    generatedCount: integer().default(0).notNull(),
    tokenIn: integer().default(0).notNull(),
    tokenOut: integer().default(0).notNull(),
    errorMessage: text(),
    errorStack: text(),
    startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp({ withTimezone: true }),
    durationMs: integer(),
    createdAt: timestamp().defaultNow()
  },
  (t) => [
    index('english_cron_job_model_attempts_run_ref_idx').on(t.runRefId),
    index('english_cron_job_model_attempts_bucket_ref_idx').on(t.bucketRefId),
    index('english_cron_job_model_attempts_status_idx').on(t.status)
  ]
);

export type EnglishCronJobModelAttempt = typeof englishCronJobModelAttempt.$inferSelect;
export type InsertEnglishCronJobModelAttempt = typeof englishCronJobModelAttempt.$inferInsert;

// ----------------------------------------------------------------------------
// Runtime config (typed EAV)
// ----------------------------------------------------------------------------

export const englishConfigRecordType = pgTable('english_config_record_types', {
  id: serial().primaryKey(),
  key: text().notNull().unique(),
  label: text().notNull(),
  description: text(),
  sortOrder: integer().default(0).notNull(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow()
});

export type EnglishConfigRecordType = typeof englishConfigRecordType.$inferSelect;
export type InsertEnglishConfigRecordType = typeof englishConfigRecordType.$inferInsert;

export const englishConfigRecord = pgTable(
  'english_config_records',
  {
    id: serial().primaryKey(),
    recordKey: text().notNull(),
    namespace: text().notNull(),
    path: text().notNull(),
    category: text().notNull(),
    label: text().notNull(),
    description: text(),
    recordTypeId: integer()
      .notNull()
      .references(() => englishConfigRecordType.id),
    valueText: text(),
    valueNumber: doublePrecision(),
    valueBoolean: boolean(),
    valueJson: jsonb(),
    defaultText: text(),
    defaultNumber: doublePrecision(),
    defaultBoolean: boolean(),
    defaultJson: jsonb(),
    validation: jsonb().$type<Record<string, unknown>>().notNull(),
    uiSchema: jsonb().$type<Record<string, unknown>>().notNull(),
    sortOrder: integer().default(0).notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [
    uniqueIndex('english_config_records_key_unique_idx').on(t.recordKey),
    index('english_config_records_category_idx').on(t.category),
    index('english_config_records_namespace_idx').on(t.namespace),
    index('english_config_records_type_idx').on(t.recordTypeId)
  ]
);

export type EnglishConfigRecord = typeof englishConfigRecord.$inferSelect;
export type InsertEnglishConfigRecord = typeof englishConfigRecord.$inferInsert;

// ----------------------------------------------------------------------------
// AI models (danh sách model active, dùng bởi aiClient.getStudyModels)
// ----------------------------------------------------------------------------

export const aiModel = pgTable('ai_models', {
  id: serial().primaryKey(),
  key: text().notNull().unique(),
  modelId: text().notNull().unique(),
  isActive: boolean().default(true).notNull(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow()
});

export type AiModel = typeof aiModel.$inferSelect;
export type InsertAiModel = typeof aiModel.$inferInsert;

// ----------------------------------------------------------------------------
// Tenants (multi-tenant auth) — mỗi client (bot/server) là 1 tenant, xác thực
// bằng API key Bearer, được cấp quyền truy cập resource quiz qua allow-list.
// Data quiz (topic/pool/config) vẫn global; tenant chỉ giới hạn access, không
// sở hữu riêng. Không thêm tenantId vào bảng english_*.
// ----------------------------------------------------------------------------

export const tenant = pgTable('tenants', {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  description: text(),
  isActive: boolean().default(true).notNull(),
  // Capability list, ví dụ ['quiz:read', 'pool:fill']. Dạng string[] để thêm
  // scope mới không cần đổi schema.
  scopes: jsonb().$type<string[]>().default([]).notNull(),
  // Bỏ qua topic/quizType allow-list cho tenant tin cậy (truy cập tất cả).
  allowAllTopics: boolean().default(false).notNull(),
  allowAllQuizTypes: boolean().default(false).notNull(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow()
});

export type Tenant = typeof tenant.$inferSelect;
export type InsertTenant = typeof tenant.$inferInsert;

// API keys của tenant. Key lưu plaintext trong cột `key` (unique) — verify bằng
// lookup trực tiếp WHERE key = raw. Đơn giản, chưa cần hash.
export const tenantApiKey = pgTable(
  'tenant_api_keys',
  {
    id: serial().primaryKey(),
    tenantId: integer()
      .notNull()
      .references(() => tenant.id),
    key: text().notNull().unique(),
    label: text(),
    isActive: boolean().default(true).notNull(),
    lastUsedAt: timestamp(),
    revokedAt: timestamp(),
    createdAt: timestamp().defaultNow()
  },
  (t) => [index('tenant_api_keys_tenant_id_idx').on(t.tenantId)]
);

export type TenantApiKey = typeof tenantApiKey.$inferSelect;
export type InsertTenantApiKey = typeof tenantApiKey.$inferInsert;

// Allow-list topic per-tenant. Không có row nào + allowAllTopics=false → tenant
// không truy cập topic nào (trừ bucket no-topic).
export const tenantTopicAccess = pgTable(
  'tenant_topic_access',
  {
    id: serial().primaryKey(),
    tenantId: integer()
      .notNull()
      .references(() => tenant.id),
    topicId: integer()
      .notNull()
      .references(() => englishTopic.id),
    createdAt: timestamp().defaultNow()
  },
  (t) => [uniqueIndex('tenant_topic_access_tenant_topic_unique_idx').on(t.tenantId, t.topicId)]
);

export type TenantTopicAccess = typeof tenantTopicAccess.$inferSelect;
export type InsertTenantTopicAccess = typeof tenantTopicAccess.$inferInsert;

// Allow-list quizType per-tenant. quizType là enum trong code (QUIZ_TYPES), nên
// không FK — validate bằng isQuizType ở service layer.
export const tenantQuizTypeAccess = pgTable(
  'tenant_quiz_type_access',
  {
    id: serial().primaryKey(),
    tenantId: integer()
      .notNull()
      .references(() => tenant.id),
    quizType: text().notNull(),
    createdAt: timestamp().defaultNow()
  },
  (t) => [uniqueIndex('tenant_quiz_type_access_tenant_type_unique_idx').on(t.tenantId, t.quizType)]
);

export type TenantQuizTypeAccess = typeof tenantQuizTypeAccess.$inferSelect;
export type InsertTenantQuizTypeAccess = typeof tenantQuizTypeAccess.$inferInsert;
