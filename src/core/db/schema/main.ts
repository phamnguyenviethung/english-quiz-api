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

// Khớp với Quantization của OpenRouter SDK (closed enum) — giữ literal union để
// gán thẳng vào chatRequest.provider mà không cần cast.
export const MODEL_QUANTIZATIONS = ['int4', 'int8', 'fp4', 'fp6', 'fp8', 'fp16', 'bf16', 'fp32', 'unknown'] as const;
export type ModelQuantization = (typeof MODEL_QUANTIZATIONS)[number];

// Subset of OpenRouter's ProviderPreferences we expose/validate in the admin API
// (see src/api/common/schemas.ts ProviderPreferencesSchema for the matching TypeBox shape).
export interface ProviderPreferencesJson {
  order?: string[];
  allowFallbacks?: boolean;
  requireParameters?: boolean;
  dataCollection?: 'allow' | 'deny';
  ignore?: string[];
  only?: string[];
  quantizations?: ModelQuantization[];
  sort?: string;
  maxPrice?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
    audio?: string;
  };
  zdr?: boolean;
}

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

export const englishQuestionPool = pgTable(
  'english_question_pool',
  {
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
  },
  (table) => [
    // Bucket (engLevel, quizType, topicId) là truy vấn nóng nhất: count/pop/refill và
    // filter ở admin UI đều đi qua tổ hợp này.
    index('idx_question_pool_bucket').on(table.engLevel, table.quizType, table.topicId),
    index('idx_question_pool_created_at').on(table.createdAt)
  ]
);

export type EnglishQuestionPool = typeof englishQuestionPool.$inferSelect;
export type InsertEnglishQuestionPool = typeof englishQuestionPool.$inferInsert;

// ----------------------------------------------------------------------------
// Reading passages — bài đọc ngắn sinh bằng LLM từ (topicName, cefrLevel, type).
// KHÁC hẳn quizType 'reading' (quiz đọc hiểu + mental math) ở english_question_pool:
// đây là nội dung thuần, chưa có câu hỏi. Bucket 3 chiều (cefrLevel, topicId, type).
// ----------------------------------------------------------------------------

export const englishReadingPassage = pgTable(
  'english_reading_passages',
  {
    id: serial().primaryKey(),
    title: text().notNull(),
    paragraphs: jsonb().$type<string[]>().notNull(),
    // Đếm lại server-side từ paragraphs, không tin số model trả về.
    wordCount: integer().notNull(),
    cefrLevel: text().notNull(),
    topicId: integer().references(() => englishTopic.id),
    // Snapshot tên topic lúc sinh — chính là input đã đưa vào prompt.
    topicName: text(),
    // 'daily' (mặc định, narrative) | 'academic' (expository) — xem READING_PASSAGE_TYPES.
    type: text().default('daily').notNull(),
    model: text().notNull(),
    tokenIn: integer().default(0).notNull(),
    tokenOut: integer().default(0).notNull(),
    // Tắt bài kém mà không cần xoá (bài đã phát cho người học vẫn tra cứu được).
    isActive: boolean().default(true).notNull(),
    // Số lần pipeline sinh câu hỏi thất bại trên bài này. Bài quá mỏng sẽ hỏng mãi,
    // nếu không đếm thì cron gọi lại mỗi lần chạy và đốt token vô hạn.
    questionGenAttempts: integer().default(0).notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [
    index('idx_reading_passages_bucket').on(t.cefrLevel, t.topicId, t.type),
    index('idx_reading_passages_created_at').on(t.createdAt)
  ]
);

export type EnglishReadingPassage = typeof englishReadingPassage.$inferSelect;
export type InsertEnglishReadingPassage = typeof englishReadingPassage.$inferInsert;

// ----------------------------------------------------------------------------
// Reading questions — câu hỏi đọc hiểu sinh TỪ một bài đọc đã lưu.
// Bucket ở đây là 1 passage (đủ questionsPerPassage câu hay chưa), khác hẳn bucket
// (cefrLevel, topicId) của bài đọc và (engLevel, quizType, topicId) của question pool.
// ----------------------------------------------------------------------------

export const englishReadingQuestion = pgTable(
  'english_reading_questions',
  {
    id: serial().primaryKey(),
    passageRefId: integer()
      .notNull()
      .references(() => englishReadingPassage.id, { onDelete: 'cascade' }),
    quizType: text().notNull(),
    question: text().notNull(),
    options: jsonb().$type<string[]>().notNull(),
    // Index 0-based vào options, không phải chữ cái cũng không phải nội dung đáp án.
    correctAnswer: integer().notNull(),
    // Một câu tiếng Việt, trỏ tới đoạn chứa evidence.
    explanation: text().notNull(),
    // Snapshot từ passage để list/filter không phải join.
    cefrLevel: text().notNull(),
    topicId: integer().references(() => englishTopic.id),
    topicName: text(),
    // Snapshot từ passage.type — xem englishReadingPassage.type.
    type: text().default('daily').notNull(),
    model: text().notNull(),
    tokenIn: integer().default(0).notNull(),
    tokenOut: integer().default(0).notNull(),
    isActive: boolean().default(true).notNull(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [
    index('idx_reading_questions_passage').on(t.passageRefId),
    index('idx_reading_questions_bucket').on(t.cefrLevel, t.topicId, t.type),
    index('idx_reading_questions_created_at').on(t.createdAt)
  ]
);

export type EnglishReadingQuestion = typeof englishReadingQuestion.$inferSelect;
export type InsertEnglishReadingQuestion = typeof englishReadingQuestion.$inferInsert;

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
    // Chi phí USD tính từ token × giá cache trên ai_models. null = model chưa có giá.
    costUsd: doublePrecision(),
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
    costUsd: doublePrecision(),
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
    costUsd: doublePrecision(),
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

  // Model có được chọn cho từng context sinh nội dung hay không, và provider routing
  // riêng cho mỗi context (schedule = cron/on-demand tự động, manual = admin trigger,
  // reading = sinh reading passage). Provider của schedule/manual nằm ở cột jsonb dưới
  // đây; riêng reading lưu normalize ở ai_model_provider_prefs (xem bên dưới).
  scheduleEnabled: boolean().default(true).notNull(),
  manualEnabled: boolean().default(true).notNull(),
  readingEnabled: boolean().default(true).notNull(),
  scheduleProvider: jsonb().$type<ProviderPreferencesJson>(),
  manualProvider: jsonb().$type<ProviderPreferencesJson>(),

  // Snapshot giá từ OpenRouter models API (USD/token), refresh qua /admin/models/:id/sync.
  pricePromptPerToken: doublePrecision(),
  priceCompletionPerToken: doublePrecision(),
  pricingRaw: jsonb().$type<Record<string, unknown>>(),
  openrouterMeta: jsonb().$type<Record<string, unknown>>(),
  pricingSyncedAt: timestamp({ withTimezone: true }),

  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow()
});

export type AiModel = typeof aiModel.$inferSelect;
export type InsertAiModel = typeof aiModel.$inferInsert;

// ----------------------------------------------------------------------------
// Provider preferences dạng normalize (thay cho blob jsonb).
// Hiện chỉ context 'reading' dùng 2 bảng này; scheduleProvider/manualProvider vẫn
// là cột jsonb trên ai_models. Cột `context` có sẵn để sau chuyển nốt 2 context kia
// sang đây thì chỉ cần thêm row, không phải đổi schema/unique index.
// Shape lắp lại đúng ProviderPreferencesJson qua providerPref.mapper.ts.
// ----------------------------------------------------------------------------

export const PROVIDER_PREF_CONTEXTS = ['reading'] as const;
export type ProviderPrefContext = (typeof PROVIDER_PREF_CONTEXTS)[number];

export const PROVIDER_PREF_VALUE_KINDS = ['order', 'ignore', 'only', 'quantization'] as const;
export type ProviderPrefValueKind = (typeof PROVIDER_PREF_VALUE_KINDS)[number];

export const aiModelProviderPref = pgTable(
  'ai_model_provider_prefs',
  {
    id: serial().primaryKey(),
    modelRefId: integer()
      .notNull()
      .references(() => aiModel.id),
    context: text().default('reading').notNull(),
    allowFallbacks: boolean(),
    requireParameters: boolean(),
    dataCollection: text(),
    sort: text(),
    zdr: boolean(),
    // OpenRouter nhận maxPrice dạng string, ở đây lưu số cho đúng kiểu — mapper lo
    // đổi qua lại (Number khi ghi, String khi assemble).
    maxPricePrompt: doublePrecision(),
    maxPriceCompletion: doublePrecision(),
    maxPriceRequest: doublePrecision(),
    maxPriceImage: doublePrecision(),
    maxPriceAudio: doublePrecision(),
    createdAt: timestamp().defaultNow(),
    updatedAt: timestamp().defaultNow()
  },
  (t) => [uniqueIndex('ai_model_provider_prefs_model_context_unique_idx').on(t.modelRefId, t.context)]
);

export type AiModelProviderPref = typeof aiModelProviderPref.$inferSelect;
export type InsertAiModelProviderPref = typeof aiModelProviderPref.$inferInsert;

// Các field dạng mảng của ProviderPreferences (order/ignore/only/quantizations) gộp
// chung một bảng, phân biệt bằng `kind`. `position` chỉ có ý nghĩa với kind='order'.
export const aiModelProviderPrefValue = pgTable(
  'ai_model_provider_pref_values',
  {
    id: serial().primaryKey(),
    prefRefId: integer()
      .notNull()
      .references(() => aiModelProviderPref.id),
    kind: text().notNull(),
    value: text().notNull(),
    position: integer().default(0).notNull(),
    createdAt: timestamp().defaultNow()
  },
  (t) => [
    uniqueIndex('ai_model_provider_pref_values_unique_idx').on(t.prefRefId, t.kind, t.value),
    index('ai_model_provider_pref_values_pref_idx').on(t.prefRefId)
  ]
);

export type AiModelProviderPrefValue = typeof aiModelProviderPrefValue.$inferSelect;
export type InsertAiModelProviderPrefValue = typeof aiModelProviderPrefValue.$inferInsert;

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
