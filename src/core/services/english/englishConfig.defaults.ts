import { z } from 'zod';
import { parseExpression as parseCronExpression } from 'cron-parser';
import { QUIZ_TYPES } from './questionTypes';

export const CONFIG_RECORD_TYPES = ['str', 'num', 'boolean', 'arr', 'obj'] as const;
export type EnglishConfigRecordTypeKey = (typeof CONFIG_RECORD_TYPES)[number];

export const ENGLISH_CONFIG_RECORD_TYPES: EnglishConfigRecordTypeDefinition[] = [
  { key: 'str', label: 'String', description: 'Short text value.', sortOrder: 10 },
  { key: 'num', label: 'Number', description: 'Integer or decimal number value.', sortOrder: 20 },
  { key: 'boolean', label: 'Boolean', description: 'On/off flag value.', sortOrder: 30 },
  { key: 'arr', label: 'Array', description: 'Structured repeated values.', sortOrder: 40 },
  { key: 'obj', label: 'Object', description: 'Structured grouped fields.', sortOrder: 50 }
];

export const ENG_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

const positiveIntSchema = z.number().int().positive();
const nonNegativeIntSchema = z.number().int().min(0);
const quizTypeSchema = z.enum(QUIZ_TYPES);

export const QuestionPoolSchema = z
  .object({
    maxPerBucket: positiveIntSchema,
    refillThresholdRatio: z.number().min(0).max(1),
    perBucketGenerationCap: positiveIntSchema,
    manualFillMinCount: positiveIntSchema,
    manualFillMaxCount: positiveIntSchema,
    manualFillDefaultCount: positiveIntSchema,
    manualFillConcurrency: positiveIntSchema
  })
  .refine((value) => value.manualFillMinCount <= value.manualFillDefaultCount, {
    message: 'manualFillDefaultCount must be >= manualFillMinCount'
  })
  .refine((value) => value.manualFillDefaultCount <= value.manualFillMaxCount, {
    message: 'manualFillDefaultCount must be <= manualFillMaxCount'
  });

function isValidCronExpression(cron: string): boolean {
  try {
    parseCronExpression(cron);
    return true;
  } catch {
    return false;
  }
}

const CronScheduleSchema = z
  .array(
    z.object({
      name: z.string().min(1),
      cron: z.string().min(1).refine(isValidCronExpression, { message: 'Invalid cron expression' })
    })
  )
  .refine((items) => new Set(items.map((item) => item.name)).size === items.length, {
    message: 'Schedule names must be unique'
  });

export const PoolRefillScheduleSchema = CronScheduleSchema;
export const ReadingRefillScheduleSchema = CronScheduleSchema;
export const ReadingQuestionRefillScheduleSchema = CronScheduleSchema;

export const ReadingPassageSchema = z
  .object({
    maxPerBucket: positiveIntSchema,
    refillThresholdRatio: z.number().min(0).max(1),
    perBucketGenerationCap: positiveIntSchema,
    manualFillMinCount: positiveIntSchema,
    manualFillMaxCount: positiveIntSchema,
    manualFillDefaultCount: positiveIntSchema,
    manualFillConcurrency: positiveIntSchema,
    excludeRecentTitleCount: nonNegativeIntSchema
  })
  .refine((value) => value.manualFillMinCount <= value.manualFillDefaultCount, {
    message: 'manualFillDefaultCount must be >= manualFillMinCount'
  })
  .refine((value) => value.manualFillDefaultCount <= value.manualFillMaxCount, {
    message: 'manualFillDefaultCount must be <= manualFillMaxCount'
  });

// Batch schema của LLM cap ở 5 item (ReadingQuestionBatchSchema), nên chặn ngay từ
// config: đặt questionsPerPassage > 5 sẽ làm cả lần gọi model fail Zod.
const readingQuestionBatchLimit = z.number().int().min(1).max(5);

export const ReadingQuestionSchema = z
  .object({
    questionsPerPassage: readingQuestionBatchLimit,
    perPassageGenerationCap: readingQuestionBatchLimit,
    maxGenerationAttempts: nonNegativeIntSchema,
    manualFillMinCount: positiveIntSchema,
    manualFillMaxCount: positiveIntSchema,
    manualFillDefaultCount: positiveIntSchema,
    manualFillConcurrency: positiveIntSchema
  })
  .refine((value) => value.manualFillMinCount <= value.manualFillDefaultCount, {
    message: 'manualFillDefaultCount must be >= manualFillMinCount'
  })
  .refine((value) => value.manualFillDefaultCount <= value.manualFillMaxCount, {
    message: 'manualFillDefaultCount must be <= manualFillMaxCount'
  });

export const QuizDistributionSchema = z
  .array(
    z.object({
      quizType: quizTypeSchema,
      weight: nonNegativeIntSchema,
      enabled: z.boolean()
    })
  )
  .min(1)
  .refine((items) => items.some((item) => item.enabled && item.weight > 0), {
    message: 'At least one enabled quiz type must have weight > 0'
  });

export const JobFlagsSchema = z.object({
  questionGenEnabled: z.boolean(),
  poolRefillEnabled: z.boolean(),
  poolRefillMaxQuestionsPerRun: positiveIntSchema,
  readingRefillEnabled: z.boolean(),
  readingRefillMaxPerRun: positiveIntSchema,
  readingQuestionRefillEnabled: z.boolean(),
  readingQuestionRefillMaxPerRun: positiveIntSchema
});

export const EnglishConfigSchemas = {
  question_pool: QuestionPoolSchema,
  quiz_distribution: QuizDistributionSchema,
  job_flags: JobFlagsSchema,
  pool_refill_schedule: PoolRefillScheduleSchema,
  reading_passage: ReadingPassageSchema,
  reading_refill_schedule: ReadingRefillScheduleSchema,
  reading_question: ReadingQuestionSchema,
  reading_question_refill_schedule: ReadingQuestionRefillScheduleSchema
} as const;

export const EnglishConfigDefaults = {
  question_pool: {
    maxPerBucket: 3,
    refillThresholdRatio: 0.5,
    perBucketGenerationCap: 5,
    manualFillMinCount: 1,
    manualFillMaxCount: 20,
    manualFillDefaultCount: 3,
    manualFillConcurrency: 3
  },
  quiz_distribution: [
    { quizType: 'fillblank', weight: 15, enabled: true },
    { quizType: 'vocab', weight: 15, enabled: true },
    { quizType: 'phrase', weight: 12, enabled: true },
    { quizType: 'conversation', weight: 9, enabled: true },
    { quizType: 'description', weight: 10, enabled: true },
    { quizType: 'synonym', weight: 9, enabled: true },
    { quizType: 'slang', weight: 9, enabled: true },
    { quizType: 'odd-one-out', weight: 5, enabled: true },
    { quizType: 'paragraph', weight: 8, enabled: true },
    { quizType: 'idiom', weight: 8, enabled: true },
    { quizType: 'verb-use-match', weight: 10, enabled: true }
  ],
  job_flags: {
    questionGenEnabled: true,
    poolRefillEnabled: true,
    poolRefillMaxQuestionsPerRun: 50,
    readingRefillEnabled: true,
    readingRefillMaxPerRun: 20,
    readingQuestionRefillEnabled: true,
    // Đơn vị là CÂU HỎI, không phải bài đọc — mỗi bài ăn 3 câu.
    readingQuestionRefillMaxPerRun: 60
  },
  pool_refill_schedule: [
    { name: 'pool-refill-morning', cron: '0 5 * * *' },
    { name: 'pool-refill-noon', cron: '0 12 * * *' },
    { name: 'pool-refill-evening', cron: '0 20 * * *' }
  ],
  reading_passage: {
    maxPerBucket: 3,
    refillThresholdRatio: 0.5,
    perBucketGenerationCap: 3,
    manualFillMinCount: 1,
    manualFillMaxCount: 10,
    manualFillDefaultCount: 2,
    manualFillConcurrency: 2,
    // Số title gần nhất trong cùng bucket đưa vào prompt để model không lặp plot.
    excludeRecentTitleCount: 15
  },
  reading_refill_schedule: [{ name: 'reading-refill-daily', cron: '0 6 * * *' }],
  reading_question: {
    questionsPerPassage: 3,
    perPassageGenerationCap: 3,
    // Bài quá mỏng sẽ hỏng mãi — quá ngưỡng này thì scan bỏ qua hẳn, khỏi đốt token.
    maxGenerationAttempts: 3,
    manualFillMinCount: 1,
    manualFillMaxCount: 50,
    manualFillDefaultCount: 10,
    manualFillConcurrency: 2
  },
  // Chạy 30 phút sau reading-refill-daily để bài sinh sáng nay có câu hỏi ngay trong buổi sáng.
  reading_question_refill_schedule: [{ name: 'reading-question-refill-daily', cron: '30 6 * * *' }]
} as const;

export type EnglishConfigKey = keyof typeof EnglishConfigDefaults;
export type QuestionPoolConfig = z.infer<typeof QuestionPoolSchema>;
export type QuizDistributionConfig = z.infer<typeof QuizDistributionSchema>;
export type JobFlagsConfig = z.infer<typeof JobFlagsSchema>;
export type ReadingPassageConfig = z.infer<typeof ReadingPassageSchema>;
export type ReadingQuestionConfig = z.infer<typeof ReadingQuestionSchema>;
export type EnglishConfigSnapshot = {
  [K in EnglishConfigKey]: z.infer<(typeof EnglishConfigSchemas)[K]>;
};

export type EnglishConfigFieldSchema = {
  type: EnglishConfigRecordTypeKey;
  label?: string;
  help?: string;
  nullable?: boolean;
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
  integer?: boolean;
  options?: readonly string[];
  fields?: Record<string, EnglishConfigFieldSchema>;
  itemType?: EnglishConfigRecordTypeKey;
  itemFields?: Record<string, EnglishConfigFieldSchema>;
};

export interface EnglishConfigRecordTypeDefinition {
  key: EnglishConfigRecordTypeKey;
  label: string;
  description: string;
  sortOrder: number;
}

export interface EnglishConfigRecordDefinition<T = unknown> {
  recordKey: string;
  namespace: EnglishConfigKey;
  path: string;
  category: string;
  label: string;
  description: string;
  recordType: EnglishConfigRecordTypeKey;
  defaultValue: T;
  validation: EnglishConfigFieldSchema;
  uiSchema: EnglishConfigFieldSchema;
  sortOrder: number;
}

const intField = (label: string, min = 0, max?: number): EnglishConfigFieldSchema => ({
  type: 'num',
  label,
  integer: true,
  min,
  ...(max === undefined ? {} : { max })
});

const percentField = (label: string): EnglishConfigFieldSchema => ({
  type: 'num',
  label,
  min: 0,
  max: 1,
  step: 0.01
});

const quizDistributionField: EnglishConfigFieldSchema = {
  type: 'arr',
  label: 'Quiz Distribution',
  itemFields: {
    quizType: {
      type: 'str',
      label: 'Quiz type',
      options: QUIZ_TYPES
    },
    weight: intField('Weight', 0),
    enabled: {
      type: 'boolean',
      label: 'Enabled'
    }
  }
};

export const ENGLISH_CONFIG_RECORD_DEFINITIONS: EnglishConfigRecordDefinition[] = [
  ...Object.entries(EnglishConfigDefaults.question_pool).map(([path, defaultValue], index) => {
    const schema =
      path === 'refillThresholdRatio' ? percentField(path) : intField(path, path === 'maxPerBucket' ? 1 : 1);
    return {
      recordKey: `question_pool.${path}`,
      namespace: 'question_pool' as const,
      path,
      category: 'pool',
      label: path,
      description: 'English question pool setting.',
      recordType: 'num' as const,
      defaultValue,
      validation: schema,
      uiSchema: schema,
      sortOrder: 400 + index * 10
    };
  }),
  {
    recordKey: 'quiz_distribution.items',
    namespace: 'quiz_distribution',
    path: 'items',
    category: 'pool',
    label: 'Quiz Distribution',
    description: 'Weighted quiz type distribution for pool and realtime generation.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.quiz_distribution,
    validation: quizDistributionField,
    uiSchema: quizDistributionField,
    sortOrder: 500
  },
  {
    recordKey: 'job_flags.questionGenEnabled',
    namespace: 'job_flags',
    path: 'questionGenEnabled',
    category: 'jobs',
    label: 'Bật Question-Gen (on-demand)',
    description: 'Tắt sẽ không tự refill pool khi pool cạn (trigger qua /pool/fill).',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.questionGenEnabled,
    validation: { type: 'boolean', label: 'Bật Question-Gen (on-demand)' },
    uiSchema: { type: 'boolean', label: 'Bật Question-Gen (on-demand)' },
    sortOrder: 600
  },
  {
    recordKey: 'job_flags.poolRefillEnabled',
    namespace: 'job_flags',
    path: 'poolRefillEnabled',
    category: 'jobs',
    label: 'Bật Pool-Refill (scheduled)',
    description: 'Tắt sẽ bỏ qua các lần refill tự động theo lịch (xem pool_refill_schedule.items).',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.poolRefillEnabled,
    validation: { type: 'boolean', label: 'Bật Pool-Refill (scheduled)' },
    uiSchema: { type: 'boolean', label: 'Bật Pool-Refill (scheduled)' },
    sortOrder: 610
  },
  {
    recordKey: 'job_flags.poolRefillMaxQuestionsPerRun',
    namespace: 'job_flags',
    path: 'poolRefillMaxQuestionsPerRun',
    category: 'jobs',
    label: 'Max câu / 1 lần Pool-Refill',
    description: 'Giới hạn tổng số câu hỏi generate trong mỗi lần Pool-Refill chạy (tối ưu cost AI).',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.poolRefillMaxQuestionsPerRun,
    validation: intField('Max câu / 1 lần Pool-Refill', 1),
    uiSchema: intField('Max câu / 1 lần Pool-Refill', 1),
    sortOrder: 620
  },
  {
    recordKey: 'job_flags.readingRefillEnabled',
    namespace: 'job_flags',
    path: 'readingRefillEnabled',
    category: 'jobs',
    label: 'Bật Reading-Refill (scheduled)',
    description: 'Tắt sẽ bỏ qua các lần sinh reading tự động theo lịch (xem reading_refill_schedule.items).',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.readingRefillEnabled,
    validation: { type: 'boolean', label: 'Bật Reading-Refill (scheduled)' },
    uiSchema: { type: 'boolean', label: 'Bật Reading-Refill (scheduled)' },
    sortOrder: 640
  },
  {
    recordKey: 'job_flags.readingRefillMaxPerRun',
    namespace: 'job_flags',
    path: 'readingRefillMaxPerRun',
    category: 'jobs',
    label: 'Max bài đọc / 1 lần Reading-Refill',
    description: 'Giới hạn tổng số reading passage sinh trong mỗi lần Reading-Refill chạy (tối ưu cost AI).',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.readingRefillMaxPerRun,
    validation: intField('Max bài đọc / 1 lần Reading-Refill', 1),
    uiSchema: intField('Max bài đọc / 1 lần Reading-Refill', 1),
    sortOrder: 650
  },
  {
    recordKey: 'job_flags.readingQuestionRefillEnabled',
    namespace: 'job_flags',
    path: 'readingQuestionRefillEnabled',
    category: 'jobs',
    label: 'Bật Reading-Question-Refill (scheduled)',
    description:
      'Tắt sẽ bỏ qua các lần sinh câu hỏi đọc hiểu tự động theo lịch ' +
      '(xem reading_question_refill_schedule.items).',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.readingQuestionRefillEnabled,
    validation: { type: 'boolean', label: 'Bật Reading-Question-Refill (scheduled)' },
    uiSchema: { type: 'boolean', label: 'Bật Reading-Question-Refill (scheduled)' },
    sortOrder: 660
  },
  {
    recordKey: 'job_flags.readingQuestionRefillMaxPerRun',
    namespace: 'job_flags',
    path: 'readingQuestionRefillMaxPerRun',
    category: 'jobs',
    label: 'Max câu hỏi / 1 lần Reading-Question-Refill',
    description:
      'Giới hạn tổng số câu hỏi đọc hiểu sinh trong mỗi lần chạy (tối ưu cost AI). ' +
      'Mỗi bài đọc ăn questionsPerPassage câu.',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.readingQuestionRefillMaxPerRun,
    validation: intField('Max câu hỏi / 1 lần Reading-Question-Refill', 1),
    uiSchema: intField('Max câu hỏi / 1 lần Reading-Question-Refill', 1),
    sortOrder: 670
  },
  {
    recordKey: 'pool_refill_schedule.items',
    namespace: 'pool_refill_schedule',
    path: 'items',
    category: 'jobs',
    label: 'Lịch chạy Pool-Refill (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled pool-refill. Đổi giá trị này sẽ reconcile lại BullMQ job ' +
      'schedulers ngay lập tức (thêm/xoá scheduler), không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.pool_refill_schedule,
    validation: {
      type: 'arr',
      label: 'Pool Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    uiSchema: {
      type: 'arr',
      label: 'Pool Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    sortOrder: 630
  },
  ...Object.entries(EnglishConfigDefaults.reading_passage).map(([path, defaultValue], index) => {
    const schema = path === 'refillThresholdRatio' ? percentField(path) : intField(path, 0);
    return {
      recordKey: `reading_passage.${path}`,
      namespace: 'reading_passage' as const,
      path,
      category: 'reading',
      label: path,
      description: 'English reading passage setting.',
      recordType: 'num' as const,
      defaultValue,
      validation: schema,
      uiSchema: schema,
      sortOrder: 700 + index * 10
    };
  }),
  {
    recordKey: 'reading_refill_schedule.items',
    namespace: 'reading_refill_schedule',
    path: 'items',
    category: 'reading',
    label: 'Lịch chạy Reading-Refill (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled reading-refill. Đổi giá trị này sẽ reconcile lại BullMQ job ' +
      'schedulers ngay lập tức (thêm/xoá scheduler), không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.reading_refill_schedule,
    validation: {
      type: 'arr',
      label: 'Reading Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    uiSchema: {
      type: 'arr',
      label: 'Reading Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    sortOrder: 800
  },
  ...Object.entries(EnglishConfigDefaults.reading_question).map(([path, defaultValue], index) => {
    const schema = intField(path, path === 'maxGenerationAttempts' ? 0 : 1);
    return {
      recordKey: `reading_question.${path}`,
      namespace: 'reading_question' as const,
      path,
      category: 'reading',
      label: path,
      description: 'English reading question setting.',
      recordType: 'num' as const,
      defaultValue,
      validation: schema,
      uiSchema: schema,
      sortOrder: 900 + index * 10
    };
  }),
  {
    recordKey: 'reading_question_refill_schedule.items',
    namespace: 'reading_question_refill_schedule',
    path: 'items',
    category: 'reading',
    label: 'Lịch chạy Reading-Question-Refill (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled reading-question-refill. Đổi giá trị này sẽ reconcile lại ' +
      'BullMQ job schedulers ngay lập tức (thêm/xoá scheduler), không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.reading_question_refill_schedule,
    validation: {
      type: 'arr',
      label: 'Reading Question Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    uiSchema: {
      type: 'arr',
      label: 'Reading Question Refill Schedule',
      itemFields: {
        name: { type: 'str', label: 'Tên scheduler' },
        cron: { type: 'str', label: 'Cron expression' }
      }
    },
    sortOrder: 950
  }
];

export function buildDefaultEnglishConfigSnapshot(): EnglishConfigSnapshot {
  return {
    question_pool: QuestionPoolSchema.parse(EnglishConfigDefaults.question_pool),
    quiz_distribution: QuizDistributionSchema.parse(EnglishConfigDefaults.quiz_distribution),
    job_flags: JobFlagsSchema.parse(EnglishConfigDefaults.job_flags),
    pool_refill_schedule: PoolRefillScheduleSchema.parse(EnglishConfigDefaults.pool_refill_schedule),
    reading_passage: ReadingPassageSchema.parse(EnglishConfigDefaults.reading_passage),
    reading_refill_schedule: ReadingRefillScheduleSchema.parse(EnglishConfigDefaults.reading_refill_schedule),
    reading_question: ReadingQuestionSchema.parse(EnglishConfigDefaults.reading_question),
    reading_question_refill_schedule: ReadingQuestionRefillScheduleSchema.parse(
      EnglishConfigDefaults.reading_question_refill_schedule
    )
  };
}
