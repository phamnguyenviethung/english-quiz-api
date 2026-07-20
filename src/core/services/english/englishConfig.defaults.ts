import { z } from 'zod';
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
  poolRefillMaxQuestionsPerRun: positiveIntSchema
});

export const EnglishConfigSchemas = {
  question_pool: QuestionPoolSchema,
  quiz_distribution: QuizDistributionSchema,
  job_flags: JobFlagsSchema
} as const;

export const EnglishConfigDefaults = {
  question_pool: {
    maxPerBucket: 3,
    refillThresholdRatio: 0.5,
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
    poolRefillMaxQuestionsPerRun: 50
  }
} as const;

export type EnglishConfigKey = keyof typeof EnglishConfigDefaults;
export type QuestionPoolConfig = z.infer<typeof QuestionPoolSchema>;
export type QuizDistributionConfig = z.infer<typeof QuizDistributionSchema>;
export type JobFlagsConfig = z.infer<typeof JobFlagsSchema>;
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
    description: 'Tắt sẽ bỏ qua các lần refill tự động theo lịch (5h/12h/20h).',
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
  }
];

export function buildDefaultEnglishConfigSnapshot(): EnglishConfigSnapshot {
  return {
    question_pool: QuestionPoolSchema.parse(EnglishConfigDefaults.question_pool),
    quiz_distribution: QuizDistributionSchema.parse(EnglishConfigDefaults.quiz_distribution),
    job_flags: JobFlagsSchema.parse(EnglishConfigDefaults.job_flags)
  };
}
