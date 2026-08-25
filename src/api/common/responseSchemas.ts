import { t, type TSchema } from 'elysia';
import { z } from 'zod';
import { ApiErrorCode } from './errorCodes';
import { ProviderPreferencesSchema, QuizTypeSchema } from './schemas';
import {
  QuestionPoolSchema,
  QuizDistributionSchema,
  JobFlagsSchema,
  PoolRefillScheduleSchema,
  ReadingPassageSchema as ReadingPassageConfigSchema,
  ReadingRefillScheduleSchema,
  ReadingQuestionSchema as ReadingQuestionConfigSchema,
  ReadingQuestionRefillScheduleSchema
} from '@/core/services/english/englishConfig.defaults';
import {
  VocabQuestionSchema,
  PhraseQuestionSchema,
  FillBlankQuestionSchema,
  ConversationQuestionSchema,
  DescriptionQuestionSchema,
  SynonymQuestionSchema,
  SlangQuestionSchema,
  OddOneOutQuestionSchema,
  ParagraphQuestionSchema,
  IdiomQuestionSchema,
  VerbUseMatchQuestionSchema,
  ReadingQuestionSchema,
  UsageSchema
} from '@/core/services/english/study.service';

// Response-side schema dùng cho OpenAPI documentation (Swagger). Tách khỏi schemas.ts
// (request-side TypeBox) để không lẫn 2 mối quan tâm khác nhau.

// ── Envelope helpers ─────────────────────────────────────────────────────────
// Khớp src/api/common/response.ts: ok()/created() -> {success,data}; list() -> +total.

export const ApiOk = <T extends TSchema>(data: T) => t.Object({ success: t.Literal(true), data });

export const ApiList = <T extends TSchema>(item: T) =>
  t.Object({ success: t.Literal(true), data: t.Array(item), total: t.Number() });

const errorCodeValues = Object.values(ApiErrorCode) as [string, ...string[]];

export const ApiErrorSchema = t.Object({
  success: t.Literal(false),
  error: t.Object({
    code: t.Union(errorCodeValues.map((c) => t.Literal(c))),
    message: t.String()
  })
});

// 401/500 luôn khả dĩ ở mọi route có auth. Route thêm code riêng (400/403/404/409) inline.
export const COMMON_ERRORS = { 401: ApiErrorSchema, 500: ApiErrorSchema } as const;

// Field timestamp: Static<> = Date (khớp giá trị Drizzle trả về ở handler, để Elysia
// static-check pass) và compile được trong TypeBox response validator lúc runtime.
// t.Date() emit `type: "Date"` (không hợp lệ JSON Schema) nhưng openapiSanitizer.ts sẽ
// rewrite thành { type: 'string', format: 'date-time' } khi serve spec — vì trên wire
// Date luôn serialize thành ISO string. KHÔNG thay bằng t.Unsafe<Date>: nó có [Kind]
// không xác định nên TypeBox response compiler throw TypeCompilerUnknownTypeError (500).
const DateTimeSchema = t.Date();

// ── Tenant ────────────────────────────────────────────────────────────────────
export const TenantSchema = t.Object({
  id: t.Number(),
  name: t.String(),
  description: t.Nullable(t.String()),
  isActive: t.Boolean(),
  allowAllTopics: t.Boolean(),
  allowAllQuizTypes: t.Boolean(),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

// ── AI Model ──────────────────────────────────────────────────────────────────
export const AiModelSchema = t.Object({
  id: t.Number(),
  key: t.String(),
  modelId: t.String(),
  isActive: t.Boolean(),
  scheduleEnabled: t.Boolean(),
  manualEnabled: t.Boolean(),
  readingEnabled: t.Boolean(),
  scheduleProvider: t.Nullable(ProviderPreferencesSchema),
  manualProvider: t.Nullable(ProviderPreferencesSchema),
  // Lưu normalize ở ai_model_provider_prefs, assemble lại đúng shape này khi trả về.
  readingProvider: t.Optional(t.Nullable(ProviderPreferencesSchema)),
  pricePromptPerToken: t.Nullable(t.Number()),
  priceCompletionPerToken: t.Nullable(t.Number()),
  pricingRaw: t.Nullable(t.Record(t.String(), t.Unknown())),
  openrouterMeta: t.Nullable(t.Record(t.String(), t.Unknown())),
  pricingSyncedAt: t.Nullable(DateTimeSchema),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

// Model trên catalog OpenRouter (chưa chắc đã được thêm vào ai_models).
export const CatalogModelSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  contextLength: t.Nullable(t.Number()),
  pricing: t.Object({
    prompt: t.Nullable(t.Number()),
    completion: t.Nullable(t.Number()),
    request: t.Nullable(t.Number()),
    image: t.Nullable(t.Number())
  }),
  supportedParameters: t.Array(t.String()),
  topProvider: t.Nullable(
    t.Object({
      contextLength: t.Nullable(t.Number()),
      maxCompletionTokens: t.Nullable(t.Number()),
      isModerated: t.Boolean()
    })
  )
});

export const ModelPricingSyncResultSchema = t.Object({
  synced: t.Number(),
  notFound: t.Array(t.String())
});

// ── Pool bucket preview ───────────────────────────────────────────────────────
export const PoolBucketSchema = t.Object({
  bucketKey: t.String({ description: '`{engLevel}:{topicId|null}:{quizType}` — id ổn định để chọn/bỏ chọn bucket.' }),
  engLevel: t.String(),
  quizType: t.String(),
  optionCount: t.Number(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  currentCount: t.Number({ description: 'Số câu đang có trong bucket.' }),
  deficiency: t.Number({ description: 'question_pool.maxPerBucket - currentCount (có thể âm nếu đang dư).' }),
  plannedCount: t.Number({ description: 'Số câu sẽ sinh cho bucket này. 0 = bị scope bỏ qua.' })
});

export const PoolBucketPreviewSchema = t.Object({
  buckets: t.Array(PoolBucketSchema),
  summary: t.Object({
    matchedBuckets: t.Number({ description: 'Số bucket khớp filter (kể cả bucket sẽ bị bỏ qua).' }),
    plannedBuckets: t.Number(),
    plannedQuestions: t.Number(),
    maxPerBucket: t.Number()
  })
});

// ── Tenant API key ───────────────────────────────────────────────────────────
// PublicApiKey = Omit<TenantApiKey,'key'> — plaintext key không bao giờ list ra.
export const PublicApiKeySchema = t.Object({
  id: t.Number(),
  tenantId: t.Number(),
  label: t.Nullable(t.String()),
  isActive: t.Boolean(),
  lastUsedAt: t.Nullable(DateTimeSchema),
  revokedAt: t.Nullable(DateTimeSchema),
  createdAt: t.Nullable(DateTimeSchema)
});

// Response issue key — chứa plaintext, chỉ trả về đúng 1 lần.
export const IssuedApiKeySchema = t.Object({
  id: t.Number(),
  label: t.Nullable(t.String()),
  apiKey: t.String({ description: 'Plaintext API key — chỉ hiển thị một lần này, lưu lại ngay.' }),
  warning: t.String()
});

// ── Tenant grants (allow-list) ───────────────────────────────────────────────
// Dùng chung cho cả GET và PUT để client sinh ra 1 type duy nhất.
export const TenantTopicAccessSchema = t.Object({
  tenantId: t.Number(),
  topicIds: t.Array(t.Number())
});

export const TenantQuizTypeAccessSchema = t.Object({
  tenantId: t.Number(),
  quizTypes: t.Array(t.String())
});

// ── English topic ────────────────────────────────────────────────────────────
export const EnglishTopicSchema = t.Object({
  id: t.Number(),
  name: t.String(),
  displayName: t.Nullable(t.String()),
  description: t.Nullable(t.String()),
  isActive: t.Boolean(),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

// Cặp topic ngẫu nhiên — mỗi phần tử là tuple 2 topic.
export const TopicPairSchema = t.Tuple([EnglishTopicSchema, EnglishTopicSchema]);

// ── Question pool ────────────────────────────────────────────────────────────
export const PoolQuestionSchema = t.Object({
  id: t.Number(),
  quizType: QuizTypeSchema,
  questionData: t.String({ description: 'JSON string chứa payload câu hỏi đã sinh.' }),
  model: t.String(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  optionCount: t.Number(),
  topicId: t.Nullable(t.Number())
});

// Row của list endpoint — thêm engLevel/topicName/createdAt so với PoolQuestionSchema
// (pop chỉ trả đúng phần payload câu hỏi, list cần thêm cột để render table admin).
export const PoolQuestionListItemSchema = t.Composite([
  PoolQuestionSchema,
  t.Object({
    engLevel: t.String(),
    topicName: t.Nullable(
      t.String({ description: 'displayName của topic, fallback name. null khi câu không gắn topic.' })
    ),
    createdAt: t.Nullable(DateTimeSchema)
  })
]);

export const PoolQuestionPageSchema = t.Object({
  items: t.Array(PoolQuestionListItemSchema),
  page: t.Number({ description: 'Trang hiện tại, 1-based.' }),
  pageSize: t.Number(),
  total: t.Number({ description: 'Tổng số câu khớp filter, không phụ thuộc trang.' }),
  totalPages: t.Number()
});

export const PoolModelStatSchema = t.Object({
  model: t.String(),
  count: t.Number({ description: 'Số câu trong pool được sinh bởi model này.' })
});

// ── Reading passages ─────────────────────────────────────────────────────────
// Bài đọc thuần (chưa có câu hỏi) — khác quizType 'reading' trong question pool.
export const ReadingPassageSchema = t.Object({
  id: t.Number(),
  title: t.String(),
  paragraphs: t.Array(t.String(), { description: 'Các đoạn văn theo đúng thứ tự đọc.' }),
  wordCount: t.Number({ description: 'Đếm server-side từ paragraphs, không lấy số model trả về.' }),
  cefrLevel: t.String(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  type: t.String({ description: 'daily | academic — xem READING_PASSAGE_TYPES.' }),
  model: t.String(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  isActive: t.Boolean(),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

export const ReadingPassagePageSchema = t.Object({
  items: t.Array(ReadingPassageSchema),
  page: t.Number({ description: 'Trang hiện tại, 1-based.' }),
  pageSize: t.Number(),
  total: t.Number({ description: 'Tổng số bài khớp filter, không phụ thuộc trang.' }),
  totalPages: t.Number()
});

export const ReadingPassageModelStatSchema = t.Object({
  model: t.String(),
  count: t.Number({ description: 'Số bài đọc trong kho được sinh bởi model này.' })
});

// Bài sinh thử qua POST /admin/readings/generate — chưa lưu nên không có id.
export const GeneratedReadingPassageSchema = t.Object({
  passage: t.Object({
    title: t.String(),
    paragraphs: t.Array(t.String()),
    wordCount: t.Number(),
    topic: t.String(),
    cefrLevel: t.String(),
    type: t.String({ description: 'daily | academic — type đã dùng để chọn prompt.' })
  }),
  usage: t.Optional(t.Object({ inputTokens: t.Number(), outputTokens: t.Number(), model: t.String() }))
});

export const ReadingBucketSchema = t.Object({
  bucketKey: t.String({ description: '`{cefrLevel}:{topicId|null}:{type}` — id ổn định để chọn/bỏ chọn bucket.' }),
  cefrLevel: t.String(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  type: t.String({ description: 'daily | academic.' }),
  currentCount: t.Number({ description: 'Số bài đang active trong bucket.' }),
  deficiency: t.Number({ description: 'reading_passage.maxPerBucket - currentCount (có thể âm nếu đang dư).' }),
  plannedCount: t.Number({ description: 'Số bài sẽ sinh cho bucket này. 0 = bị scope bỏ qua.' })
});

export const ReadingBucketPreviewSchema = t.Object({
  buckets: t.Array(ReadingBucketSchema),
  summary: t.Object({
    matchedBuckets: t.Number({ description: 'Số bucket khớp filter (kể cả bucket sẽ bị bỏ qua).' }),
    plannedBuckets: t.Number(),
    plannedPassages: t.Number(),
    maxPerBucket: t.Number()
  })
});

// ── Reading questions ────────────────────────────────────────────────────────
// Câu hỏi đọc hiểu sinh từ một reading passage. Bucket là 1 passage, không phải
// tổ hợp (cefrLevel, topicId) như bài đọc.
export const ReadingQuestionRecordSchema = t.Object({
  id: t.Number(),
  passageRefId: t.Number({ description: 'Bài đọc mà câu hỏi này thuộc về.' }),
  quizType: t.String({ description: 'detail / inference / vocabulary_context / ... (theo CEFR level).' }),
  question: t.String(),
  options: t.Array(t.String(), { description: 'Đúng 4 đáp án.' }),
  correctAnswer: t.Number({ description: 'Index 0-based vào options.' }),
  explanation: t.String({ description: 'Một câu tiếng Việt, trỏ tới đoạn chứa evidence.' }),
  cefrLevel: t.String(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  type: t.String({ description: 'daily | academic — snapshot từ passage lúc sinh câu hỏi.' }),
  model: t.String(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  isActive: t.Boolean(),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

export const ReadingQuestionPageSchema = t.Object({
  items: t.Array(ReadingQuestionRecordSchema),
  page: t.Number({ description: 'Trang hiện tại, 1-based.' }),
  pageSize: t.Number(),
  total: t.Number({ description: 'Tổng số câu khớp filter, không phụ thuộc trang.' }),
  totalPages: t.Number()
});

export const ReadingQuestionModelStatSchema = t.Object({
  model: t.String(),
  count: t.Number({ description: 'Số câu hỏi trong kho được sinh bởi model này.' })
});

// Câu sinh thử qua POST /admin/reading-questions/generate — chưa lưu nên không có id.
export const GeneratedReadingQuestionsSchema = t.Object({
  passage: t.Object({
    id: t.Number(),
    title: t.String(),
    cefrLevel: t.String(),
    topicName: t.Nullable(t.String())
  }),
  questions: t.Array(
    t.Object({
      quizType: t.String(),
      question: t.String(),
      options: t.Array(t.String()),
      correctAnswer: t.Number(),
      explanation: t.String()
    })
  ),
  usage: t.Optional(t.Object({ inputTokens: t.Number(), outputTokens: t.Number(), model: t.String() }))
});

export const ReadingQuestionBucketSchema = t.Object({
  bucketKey: t.String({ description: '`rq:{passageId}` — bucket của pipeline này là 1 bài đọc.' }),
  passageId: t.Number(),
  title: t.String(),
  cefrLevel: t.String(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  currentCount: t.Number({ description: 'Số câu đang active của bài này.' }),
  deficiency: t.Number({ description: 'reading_question.questionsPerPassage - currentCount.' }),
  plannedCount: t.Number({ description: 'Số câu sẽ sinh cho bài này. 0 = bị mode bỏ qua.' })
});

export const ReadingQuestionBucketPreviewSchema = t.Object({
  buckets: t.Array(ReadingQuestionBucketSchema),
  summary: t.Object({
    matchedPassages: t.Number({ description: 'Số bài khớp filter (kể cả bài sẽ bị bỏ qua).' }),
    plannedPassages: t.Number(),
    plannedQuestions: t.Number(),
    questionsPerPassage: t.Number()
  })
});

// Trả cho tenant/bot: bài đọc kèm trọn bộ câu hỏi.
export const ReadingWithQuestionsSchema = t.Object({
  passage: t.Object({
    id: t.Number(),
    title: t.String(),
    paragraphs: t.Array(t.String()),
    wordCount: t.Number(),
    cefrLevel: t.String(),
    topicId: t.Nullable(t.Number()),
    topicName: t.Nullable(t.String()),
    type: t.String({ description: 'daily | academic.' })
  }),
  questions: t.Array(ReadingQuestionRecordSchema)
});

// ── English config ───────────────────────────────────────────────────────────
// Zod schema có sẵn (englishConfig.defaults.ts) — dùng trực tiếp thay vì viết lại TypeBox.
export const EnglishConfigSnapshotSchema = z.object({
  question_pool: QuestionPoolSchema,
  quiz_distribution: QuizDistributionSchema,
  job_flags: JobFlagsSchema,
  pool_refill_schedule: PoolRefillScheduleSchema,
  reading_passage: ReadingPassageConfigSchema,
  reading_refill_schedule: ReadingRefillScheduleSchema,
  reading_question: ReadingQuestionConfigSchema,
  reading_question_refill_schedule: ReadingQuestionRefillScheduleSchema
});

export const EnglishConfigSnapshotResponseSchema = z.object({
  success: z.literal(true),
  data: EnglishConfigSnapshotSchema
});

// Full DB row (englishConfigRecord) + 3 field derive (recordType/value/defaultValue).
// value/defaultValue/validation/uiSchema giữ Unknown vì shape phụ thuộc recordType từng
// record — xem GET /english/config/records để biết validation/uiSchema cụ thể.
export const EnglishConfigRecordViewSchema = t.Object({
  id: t.Number(),
  recordKey: t.String(),
  namespace: t.String(),
  path: t.String(),
  category: t.String(),
  label: t.String(),
  description: t.Nullable(t.String()),
  recordTypeId: t.Number(),
  valueText: t.Nullable(t.String()),
  valueNumber: t.Nullable(t.Number()),
  valueBoolean: t.Nullable(t.Boolean()),
  valueJson: t.Nullable(t.Unknown()),
  defaultText: t.Nullable(t.String()),
  defaultNumber: t.Nullable(t.Number()),
  defaultBoolean: t.Nullable(t.Boolean()),
  defaultJson: t.Nullable(t.Unknown()),
  validation: t.Unknown({ description: 'Mô tả ràng buộc giá trị (dùng để build form admin).' }),
  uiSchema: t.Unknown({ description: 'Gợi ý hiển thị form admin.' }),
  sortOrder: t.Number(),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema),
  recordType: t.Union([t.Literal('str'), t.Literal('num'), t.Literal('boolean'), t.Literal('arr'), t.Literal('obj')]),
  value: t.Unknown({ description: 'Giá trị hiện tại, đã coerce theo recordType.' }),
  defaultValue: t.Unknown({ description: 'Giá trị mặc định, đã coerce theo recordType.' })
});

// ── Cron tracking ─────────────────────────────────────────────────────────────
// Full row englishCronJobRun — GET /english/cron/runs thực tế trả full row (không phải
// EnglishCronJobRunListItem hẹp hơn tồn tại cùng file service nhưng không được dùng ở
// đây) nên document theo hành vi thật, không theo shape lý tưởng.
export const EnglishCronJobRunSchema = t.Object({
  id: t.Number(),
  runId: t.String(),
  jobKey: t.String(),
  trigger: t.String(),
  status: t.String(),
  queueName: t.Nullable(t.String()),
  bullJobId: t.Nullable(t.String()),
  bullJobName: t.Nullable(t.String()),
  totalBuckets: t.Number(),
  deficientBuckets: t.Number(),
  succeededBuckets: t.Number(),
  failedBuckets: t.Number(),
  skippedBuckets: t.Number(),
  requestedQuestions: t.Number(),
  generatedQuestions: t.Number(),
  insertedQuestions: t.Number(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  costUsd: t.Nullable(t.Number()),
  errorPhase: t.Nullable(t.String()),
  errorMessage: t.Nullable(t.String()),
  errorStack: t.Nullable(t.String()),
  metadata: t.Nullable(t.Unknown()),
  startedAt: DateTimeSchema,
  finishedAt: t.Nullable(DateTimeSchema),
  durationMs: t.Nullable(t.Number()),
  createdAt: t.Nullable(DateTimeSchema),
  updatedAt: t.Nullable(DateTimeSchema)
});

export const EnglishCronJobBucketDetailSchema = t.Object({
  id: t.Number(),
  status: t.String(),
  engLevel: t.String(),
  quizType: t.String(),
  topicId: t.Nullable(t.Number()),
  topicName: t.Nullable(t.String()),
  requestedCount: t.Number(),
  generatedCount: t.Number(),
  insertedCount: t.Number(),
  costUsd: t.Nullable(t.Number()),
  errorPhase: t.Nullable(t.String()),
  errorMessage: t.Nullable(t.String()),
  errorStack: t.Nullable(t.String())
});

export const EnglishCronJobModelAttemptDetailSchema = t.Object({
  id: t.Number(),
  bucketRefId: t.Number(),
  model: t.String(),
  attemptOrder: t.Number(),
  status: t.String(),
  generatedCount: t.Number(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  costUsd: t.Nullable(t.Number()),
  errorMessage: t.Nullable(t.String())
});

export const CronRunDetailSchema = t.Object({
  run: EnglishCronJobRunSchema,
  buckets: t.Array(EnglishCronJobBucketDetailSchema),
  attempts: t.Array(EnglishCronJobModelAttemptDetailSchema),
  hasNextBuckets: t.Boolean()
});

// Tổng hợp chi tiêu theo ngày hoặc theo model. `bucket` = nhãn nhóm (ISO date
// hoặc modelId tuỳ groupBy). costUsd bỏ qua attempt của model chưa có giá cache.
export const CronUsageAnalyticsItemSchema = t.Object({
  bucket: t.String(),
  costUsd: t.Number(),
  tokenIn: t.Number(),
  tokenOut: t.Number(),
  requestCount: t.Number(),
  successCount: t.Number(),
  failedCount: t.Number()
});

// ── Generation (Zod — tái dùng schema đã có trong study.service.ts) ──────────
// Response phụ thuộc :quizType tại runtime nên không thể gán 1 schema tĩnh theo path
// param ở type-level; union discriminated theo quizType là cách chính xác nhất.
const GenerateQuestionUnion = z.union([
  z.object({ quizType: z.literal('vocab'), question: VocabQuestionSchema, usage: UsageSchema.optional() }),
  z.object({ quizType: z.literal('phrase'), question: PhraseQuestionSchema, usage: UsageSchema.optional() }),
  z.object({ quizType: z.literal('fillblank'), question: FillBlankQuestionSchema, usage: UsageSchema.optional() }),
  z.object({
    quizType: z.literal('conversation'),
    question: ConversationQuestionSchema,
    usage: UsageSchema.optional()
  }),
  z.object({
    quizType: z.literal('description'),
    question: DescriptionQuestionSchema,
    usage: UsageSchema.optional()
  }),
  z.object({ quizType: z.literal('synonym'), question: SynonymQuestionSchema, usage: UsageSchema.optional() }),
  z.object({ quizType: z.literal('slang'), question: SlangQuestionSchema, usage: UsageSchema.optional() }),
  z.object({
    quizType: z.literal('odd-one-out'),
    question: OddOneOutQuestionSchema,
    usage: UsageSchema.optional()
  }),
  z.object({ quizType: z.literal('paragraph'), question: ParagraphQuestionSchema, usage: UsageSchema.optional() }),
  z.object({ quizType: z.literal('idiom'), question: IdiomQuestionSchema, usage: UsageSchema.optional() }),
  z.object({
    quizType: z.literal('verb-use-match'),
    question: VerbUseMatchQuestionSchema,
    usage: UsageSchema.optional()
  })
]);

export const GenerateQuestionResponseSchema = z.object({ success: z.literal(true), data: GenerateQuestionUnion });

export const GenerateReadingResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    quizType: z.literal('reading'),
    question: ReadingQuestionSchema,
    usage: UsageSchema.optional()
  })
});

// Error envelope dạng Zod — dùng cho response object có key 200 là Zod (generate routes)
// để tránh trộn TypeBox/Zod trong cùng 1 response map nếu Elysia không chấp nhận mix.
export const ApiErrorZodSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.enum(Object.values(ApiErrorCode) as [string, ...string[]]),
    message: z.string()
  })
});
