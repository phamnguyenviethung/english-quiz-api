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
export const SiblingGenScheduleSchema = CronScheduleSchema;

// Sinh "câu tương tự" (sibling) tự động: quét bucket thiếu, lấy câu gốc sẵn có sinh biến thể.
// siblingsPerSource cap ở 5 vì batch schema của LLM cap ở 5 item.
export const SiblingGenSchema = z.object({
  sourcesPerBucketPerRun: positiveIntSchema,
  siblingsPerSource: z.number().int().min(1).max(5),
  maxSiblingsPerRun: positiveIntSchema
});

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

// Loại câu nào được sinh/phục vụ cho beginner. Chỉ có tác dụng khi loại đó cũng đang bật ở
// quiz_distribution (kill switch chung) — xem getBeginnerQuizTypes ở questionPool.service.
export const BeginnerQuizTypesSchema = z
  .array(
    z.object({
      quizType: quizTypeSchema,
      enabled: z.boolean()
    })
  )
  .refine((items) => new Set(items.map((item) => item.quizType)).size === items.length, {
    message: 'Each quiz type may appear only once'
  });

export const JobFlagsSchema = z.object({
  questionGenEnabled: z.boolean(),
  poolRefillEnabled: z.boolean(),
  poolRefillMaxQuestionsPerRun: positiveIntSchema,
  readingRefillEnabled: z.boolean(),
  readingRefillMaxPerRun: positiveIntSchema,
  readingQuestionRefillEnabled: z.boolean(),
  readingQuestionRefillMaxPerRun: positiveIntSchema,
  siblingGenEnabled: z.boolean()
});

export const EnglishConfigSchemas = {
  question_pool: QuestionPoolSchema,
  quiz_distribution: QuizDistributionSchema,
  beginner_quiz_types: BeginnerQuizTypesSchema,
  job_flags: JobFlagsSchema,
  pool_refill_schedule: PoolRefillScheduleSchema,
  sibling_gen: SiblingGenSchema,
  sibling_gen_schedule: SiblingGenScheduleSchema,
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
  // slang/idiom mặc định tắt: ít gặp trong sách giáo khoa, khó với người mới học.
  beginner_quiz_types: [
    { quizType: 'vocab', enabled: true },
    { quizType: 'fillblank', enabled: true },
    { quizType: 'phrase', enabled: true },
    { quizType: 'conversation', enabled: true },
    { quizType: 'description', enabled: true },
    { quizType: 'synonym', enabled: true },
    { quizType: 'slang', enabled: false },
    { quizType: 'odd-one-out', enabled: true },
    { quizType: 'paragraph', enabled: true },
    { quizType: 'idiom', enabled: false },
    { quizType: 'verb-use-match', enabled: true }
  ],
  job_flags: {
    questionGenEnabled: true,
    poolRefillEnabled: true,
    poolRefillMaxQuestionsPerRun: 50,
    readingRefillEnabled: true,
    readingRefillMaxPerRun: 20,
    readingQuestionRefillEnabled: true,
    // Đơn vị là CÂU HỎI, không phải bài đọc — mỗi bài ăn 3 câu.
    readingQuestionRefillMaxPerRun: 60,
    // Mặc định TẮT — sinh sibling tự động là tính năng opt-in.
    siblingGenEnabled: false
  },
  pool_refill_schedule: [
    { name: 'pool-refill-morning', cron: '0 5 * * *' },
    { name: 'pool-refill-noon', cron: '0 12 * * *' },
    { name: 'pool-refill-evening', cron: '0 20 * * *' }
  ],
  sibling_gen: {
    sourcesPerBucketPerRun: 2,
    siblingsPerSource: 3,
    maxSiblingsPerRun: 40
  },
  sibling_gen_schedule: [{ name: 'sibling-gen-daily', cron: '0 3 * * *' }],
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
export type BeginnerQuizTypesConfig = z.infer<typeof BeginnerQuizTypesSchema>;
export type JobFlagsConfig = z.infer<typeof JobFlagsSchema>;
export type SiblingGenConfig = z.infer<typeof SiblingGenSchema>;
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
  /** Hậu tố hiển thị cạnh ô nhập: 'câu' | 'bài' | 'luồng' | 'lần' | '%'. */
  unit?: string;
  /** Giá trị lưu là ratio 0..1 nhưng admin UI nhập/hiện dưới dạng 0..100. */
  display?: 'percent';
};

/** Nhóm cấp 1 của admin UI: mỗi category là một pipeline độc lập. */
export const ENGLISH_CONFIG_CATEGORIES = ['questions', 'reading', 'reading_question'] as const;
export type EnglishConfigCategory = (typeof ENGLISH_CONFIG_CATEGORIES)[number];

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
  category: EnglishConfigCategory;
  label: string;
  description: string;
  recordType: EnglishConfigRecordTypeKey;
  defaultValue: T;
  validation: EnglishConfigFieldSchema;
  uiSchema: EnglishConfigFieldSchema;
  sortOrder: number;
}

const intField = (label: string, min = 0, max?: number, unit?: string): EnglishConfigFieldSchema => ({
  type: 'num',
  label,
  integer: true,
  min,
  ...(max === undefined ? {} : { max }),
  ...(unit === undefined ? {} : { unit })
});

const percentField = (label: string): EnglishConfigFieldSchema => ({
  type: 'num',
  label,
  min: 0,
  max: 1,
  step: 0.01,
  unit: '%',
  display: 'percent'
});

const boolField = (label: string): EnglishConfigFieldSchema => ({ type: 'boolean', label });

const cronScheduleField = (label: string): EnglishConfigFieldSchema => ({
  type: 'arr',
  label,
  itemFields: {
    name: { type: 'str', label: 'Tên scheduler' },
    cron: { type: 'str', label: 'Cron expression' }
  }
});

const quizDistributionField: EnglishConfigFieldSchema = {
  type: 'arr',
  label: 'Phân bổ loại câu hỏi',
  itemFields: {
    quizType: {
      type: 'str',
      label: 'Loại câu hỏi',
      options: QUIZ_TYPES
    },
    weight: intField('Trọng số', 0),
    enabled: boolField('Bật')
  }
};

const beginnerQuizTypesField: EnglishConfigFieldSchema = {
  type: 'arr',
  label: 'Loại câu hỏi cho beginner',
  itemFields: {
    quizType: {
      type: 'str',
      label: 'Loại câu hỏi',
      options: QUIZ_TYPES
    },
    enabled: boolField('Bật cho beginner')
  }
};

/**
 * Metadata trình bày cho từng field của một namespace. Khai theo `Record<keyof Config, ...>`
 * để thêm field vào schema mà quên khai ở đây sẽ lỗi compile chứ không âm thầm rơi về tên path.
 */
interface ConfigFieldMeta {
  label: string;
  description: string;
  category: EnglishConfigCategory;
  sortOrder: number;
  schema: EnglishConfigFieldSchema;
}

const QUESTION_POOL_FIELDS: Record<keyof QuestionPoolConfig, ConfigFieldMeta> = {
  maxPerBucket: {
    label: 'Số câu tối đa mỗi bucket',
    description: 'Số câu hỏi giữ sẵn cho mỗi cặp (level, loại câu hỏi). Đạt ngưỡng này thì job refill dừng sinh thêm.',
    category: 'questions',
    sortOrder: 1000,
    schema: intField('Số câu tối đa mỗi bucket', 1, undefined, 'câu')
  },
  refillThresholdRatio: {
    label: 'Ngưỡng kích hoạt refill',
    description: 'Tồn kho tụt dưới tỷ lệ này so với mức tối đa thì bucket được đưa vào hàng đợi refill.',
    category: 'questions',
    sortOrder: 1010,
    schema: percentField('Ngưỡng kích hoạt refill')
  },
  perBucketGenerationCap: {
    label: 'Trần sinh mỗi bucket một lần',
    description: 'Trần số câu sinh cho một bucket trong một lần refill, tránh dồn hết quota AI vào một bucket.',
    category: 'questions',
    sortOrder: 1020,
    schema: intField('Trần sinh mỗi bucket một lần', 1, undefined, 'câu')
  },
  manualFillMinCount: {
    label: 'Số câu tối thiểu mỗi lần sinh thủ công',
    description: 'Chặn dưới cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'questions',
    sortOrder: 1100,
    schema: intField('Số câu tối thiểu mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillDefaultCount: {
    label: 'Số câu mặc định mỗi lần sinh thủ công',
    description: 'Giá trị điền sẵn ở màn Sinh hàng loạt. Phải nằm giữa mức tối thiểu và tối đa.',
    category: 'questions',
    sortOrder: 1110,
    schema: intField('Số câu mặc định mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillMaxCount: {
    label: 'Số câu tối đa mỗi lần sinh thủ công',
    description: 'Chặn trên cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'questions',
    sortOrder: 1120,
    schema: intField('Số câu tối đa mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillConcurrency: {
    label: 'Số luồng sinh song song',
    description:
      'Số bucket được sinh song song trong một lần chạy thủ công. Tăng thì nhanh hơn nhưng dễ chạm rate limit của model.',
    category: 'questions',
    sortOrder: 1130,
    schema: intField('Số luồng sinh song song', 1, undefined, 'luồng')
  }
};

const SIBLING_GEN_FIELDS: Record<keyof SiblingGenConfig, ConfigFieldMeta> = {
  sourcesPerBucketPerRun: {
    label: 'Số câu gốc lấy mỗi bucket',
    description: 'Mỗi lần chạy auto, với mỗi bucket thiếu lấy tối đa bao nhiêu câu gốc để sinh câu tương tự.',
    category: 'questions',
    sortOrder: 1300,
    schema: intField('Số câu gốc lấy mỗi bucket', 1, undefined, 'câu')
  },
  siblingsPerSource: {
    label: 'Số câu tương tự mỗi câu gốc',
    description: 'Số biến thể sinh cho mỗi câu gốc trong một lần chạy. Batch schema của model cap ở 5.',
    category: 'questions',
    sortOrder: 1310,
    schema: intField('Số câu tương tự mỗi câu gốc', 1, 5, 'câu')
  },
  maxSiblingsPerRun: {
    label: 'Max câu tương tự / 1 lần chạy',
    description: 'Trần tổng số câu tương tự sinh trong một lần chạy auto (tối ưu cost AI).',
    category: 'questions',
    sortOrder: 1320,
    schema: intField('Max câu tương tự / 1 lần chạy', 1, undefined, 'câu')
  }
};

const READING_PASSAGE_FIELDS: Record<keyof ReadingPassageConfig, ConfigFieldMeta> = {
  maxPerBucket: {
    label: 'Số bài đọc tối đa mỗi bucket',
    description: 'Số bài đọc giữ sẵn cho mỗi cặp (level, chủ đề). Đạt ngưỡng này thì job refill dừng sinh thêm.',
    category: 'reading',
    sortOrder: 2000,
    schema: intField('Số bài đọc tối đa mỗi bucket', 1, undefined, 'bài')
  },
  refillThresholdRatio: {
    label: 'Ngưỡng kích hoạt refill',
    description: 'Tồn kho tụt dưới tỷ lệ này so với mức tối đa thì bucket được đưa vào hàng đợi refill.',
    category: 'reading',
    sortOrder: 2010,
    schema: percentField('Ngưỡng kích hoạt refill')
  },
  perBucketGenerationCap: {
    label: 'Trần sinh mỗi bucket một lần',
    description: 'Trần số bài đọc sinh cho một bucket trong một lần refill.',
    category: 'reading',
    sortOrder: 2020,
    schema: intField('Trần sinh mỗi bucket một lần', 1, undefined, 'bài')
  },
  excludeRecentTitleCount: {
    label: 'Số tiêu đề gần nhất cần tránh lặp',
    description: 'Số tiêu đề gần nhất trong cùng bucket đưa vào prompt để model không lặp lại nội dung cũ.',
    category: 'reading',
    sortOrder: 2030,
    schema: intField('Số tiêu đề gần nhất cần tránh lặp', 0, undefined, 'tiêu đề')
  },
  manualFillMinCount: {
    label: 'Số bài tối thiểu mỗi lần sinh thủ công',
    description: 'Chặn dưới cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'reading',
    sortOrder: 2100,
    schema: intField('Số bài tối thiểu mỗi lần sinh thủ công', 1, undefined, 'bài')
  },
  manualFillDefaultCount: {
    label: 'Số bài mặc định mỗi lần sinh thủ công',
    description: 'Giá trị điền sẵn ở màn Sinh hàng loạt. Phải nằm giữa mức tối thiểu và tối đa.',
    category: 'reading',
    sortOrder: 2110,
    schema: intField('Số bài mặc định mỗi lần sinh thủ công', 1, undefined, 'bài')
  },
  manualFillMaxCount: {
    label: 'Số bài tối đa mỗi lần sinh thủ công',
    description: 'Chặn trên cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'reading',
    sortOrder: 2120,
    schema: intField('Số bài tối đa mỗi lần sinh thủ công', 1, undefined, 'bài')
  },
  manualFillConcurrency: {
    label: 'Số luồng sinh song song',
    description:
      'Số bucket được sinh song song trong một lần chạy thủ công. Tăng thì nhanh hơn nhưng dễ chạm rate limit của model.',
    category: 'reading',
    sortOrder: 2130,
    schema: intField('Số luồng sinh song song', 1, undefined, 'luồng')
  }
};

const READING_QUESTION_FIELDS: Record<keyof ReadingQuestionConfig, ConfigFieldMeta> = {
  questionsPerPassage: {
    label: 'Số câu hỏi mỗi bài đọc',
    description: 'Số câu hỏi đọc hiểu sinh cho mỗi bài đọc. Batch schema của model cap ở 5 câu nên không đặt cao hơn.',
    category: 'reading_question',
    sortOrder: 3000,
    schema: intField('Số câu hỏi mỗi bài đọc', 1, 5, 'câu')
  },
  perPassageGenerationCap: {
    label: 'Trần sinh mỗi bài đọc một lần',
    description: 'Trần số câu sinh cho một bài đọc trong một lần chạy. Batch schema của model cap ở 5 câu.',
    category: 'reading_question',
    sortOrder: 3010,
    schema: intField('Trần sinh mỗi bài đọc một lần', 1, 5, 'câu')
  },
  maxGenerationAttempts: {
    label: 'Số lần thử tối đa mỗi bài đọc',
    description:
      'Số lần thử sinh câu hỏi cho một bài đọc trước khi bỏ qua hẳn. Bài quá mỏng sẽ hỏng mãi nên cần chặn để khỏi đốt token.',
    category: 'reading_question',
    sortOrder: 3020,
    schema: intField('Số lần thử tối đa mỗi bài đọc', 0, undefined, 'lần')
  },
  manualFillMinCount: {
    label: 'Số câu tối thiểu mỗi lần sinh thủ công',
    description: 'Chặn dưới cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'reading_question',
    sortOrder: 3100,
    schema: intField('Số câu tối thiểu mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillDefaultCount: {
    label: 'Số câu mặc định mỗi lần sinh thủ công',
    description: 'Giá trị điền sẵn ở màn Sinh hàng loạt. Phải nằm giữa mức tối thiểu và tối đa.',
    category: 'reading_question',
    sortOrder: 3110,
    schema: intField('Số câu mặc định mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillMaxCount: {
    label: 'Số câu tối đa mỗi lần sinh thủ công',
    description: 'Chặn trên cho ô số lượng ở màn Sinh hàng loạt.',
    category: 'reading_question',
    sortOrder: 3120,
    schema: intField('Số câu tối đa mỗi lần sinh thủ công', 1, undefined, 'câu')
  },
  manualFillConcurrency: {
    label: 'Số luồng sinh song song',
    description:
      'Số bài đọc được sinh câu hỏi song song trong một lần chạy thủ công. Tăng thì nhanh hơn nhưng dễ chạm rate limit của model.',
    category: 'reading_question',
    sortOrder: 3130,
    schema: intField('Số luồng sinh song song', 1, undefined, 'luồng')
  }
};

function numericRecords<T extends Record<string, number>>(
  namespace: EnglishConfigKey,
  defaults: T,
  fields: Record<keyof T, ConfigFieldMeta>
): EnglishConfigRecordDefinition[] {
  return (Object.keys(defaults) as (keyof T & string)[]).map((path) => {
    const meta = fields[path];
    return {
      recordKey: `${namespace}.${path}`,
      namespace,
      path,
      category: meta.category,
      label: meta.label,
      description: meta.description,
      recordType: 'num' as const,
      defaultValue: defaults[path],
      validation: meta.schema,
      uiSchema: meta.schema,
      sortOrder: meta.sortOrder
    };
  });
}

export const ENGLISH_CONFIG_RECORD_DEFINITIONS: EnglishConfigRecordDefinition[] = [
  // ── Câu hỏi ────────────────────────────────────────────────────────────────
  ...numericRecords('question_pool', EnglishConfigDefaults.question_pool, QUESTION_POOL_FIELDS),
  {
    recordKey: 'quiz_distribution.items',
    namespace: 'quiz_distribution',
    path: 'items',
    category: 'questions',
    label: 'Phân bổ loại câu hỏi',
    description:
      'Trọng số bốc từng loại câu hỏi, dùng chung cho cả pool lẫn sinh realtime. Phải có ít nhất một loại đang bật với trọng số lớn hơn 0.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.quiz_distribution,
    validation: quizDistributionField,
    uiSchema: quizDistributionField,
    sortOrder: 1050
  },
  {
    recordKey: 'beginner_quiz_types.items',
    namespace: 'beginner_quiz_types',
    path: 'items',
    category: 'questions',
    label: 'Loại câu hỏi cho beginner',
    description:
      'Loại câu hỏi được sinh và phục vụ cho người mới học (≤ B1, ≤ 4 đáp án). Chỉ có tác dụng khi loại đó cũng đang bật ở Phân bổ loại câu hỏi. Bucket beginner chỉ được tạo cho topic bật cờ beginner.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.beginner_quiz_types,
    validation: beginnerQuizTypesField,
    uiSchema: beginnerQuizTypesField,
    sortOrder: 1060
  },
  {
    recordKey: 'job_flags.questionGenEnabled',
    namespace: 'job_flags',
    path: 'questionGenEnabled',
    category: 'questions',
    label: 'Bật Question-Gen (on-demand)',
    description: 'Tắt sẽ không tự refill pool khi pool cạn (trigger qua /pool/fill).',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.questionGenEnabled,
    validation: boolField('Bật Question-Gen (on-demand)'),
    uiSchema: boolField('Bật Question-Gen (on-demand)'),
    sortOrder: 1200
  },
  {
    recordKey: 'job_flags.poolRefillEnabled',
    namespace: 'job_flags',
    path: 'poolRefillEnabled',
    category: 'questions',
    label: 'Bật Pool-Refill (scheduled)',
    description: 'Tắt sẽ bỏ qua các lần refill tự động theo lịch bên dưới.',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.poolRefillEnabled,
    validation: boolField('Bật Pool-Refill (scheduled)'),
    uiSchema: boolField('Bật Pool-Refill (scheduled)'),
    sortOrder: 1210
  },
  {
    recordKey: 'job_flags.poolRefillMaxQuestionsPerRun',
    namespace: 'job_flags',
    path: 'poolRefillMaxQuestionsPerRun',
    category: 'questions',
    label: 'Max câu / 1 lần Pool-Refill',
    description: 'Giới hạn tổng số câu hỏi generate trong mỗi lần Pool-Refill chạy (tối ưu cost AI).',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.poolRefillMaxQuestionsPerRun,
    validation: intField('Max câu / 1 lần Pool-Refill', 1, undefined, 'câu'),
    uiSchema: intField('Max câu / 1 lần Pool-Refill', 1, undefined, 'câu'),
    sortOrder: 1220
  },
  {
    recordKey: 'pool_refill_schedule.items',
    namespace: 'pool_refill_schedule',
    path: 'items',
    category: 'questions',
    label: 'Lịch chạy Pool-Refill (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled pool-refill. Đổi giá trị này sẽ reconcile lại BullMQ job ' +
      'schedulers ngay lập tức (thêm/xoá scheduler), không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.pool_refill_schedule,
    validation: cronScheduleField('Lịch chạy Pool-Refill'),
    uiSchema: cronScheduleField('Lịch chạy Pool-Refill'),
    sortOrder: 1230
  },

  // ── Sinh câu tương tự (auto) ───────────────────────────────────────────────
  ...numericRecords('sibling_gen', EnglishConfigDefaults.sibling_gen, SIBLING_GEN_FIELDS),
  {
    recordKey: 'job_flags.siblingGenEnabled',
    namespace: 'job_flags',
    path: 'siblingGenEnabled',
    category: 'questions',
    label: 'Bật Sinh câu tương tự (scheduled)',
    description:
      'Tắt sẽ bỏ qua các lần sinh câu tương tự tự động theo lịch bên dưới. Sinh thủ công (nút trên từng câu) ' +
      'không phụ thuộc cờ này.',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.siblingGenEnabled,
    validation: boolField('Bật Sinh câu tương tự (scheduled)'),
    uiSchema: boolField('Bật Sinh câu tương tự (scheduled)'),
    sortOrder: 1330
  },
  {
    recordKey: 'sibling_gen_schedule.items',
    namespace: 'sibling_gen_schedule',
    path: 'items',
    category: 'questions',
    label: 'Lịch chạy Sinh câu tương tự (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled sibling-gen. Đổi giá trị này sẽ reconcile lại BullMQ job ' +
      'schedulers ngay lập tức, không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.sibling_gen_schedule,
    validation: cronScheduleField('Lịch chạy Sinh câu tương tự'),
    uiSchema: cronScheduleField('Lịch chạy Sinh câu tương tự'),
    sortOrder: 1340
  },

  // ── Bài đọc ────────────────────────────────────────────────────────────────
  ...numericRecords('reading_passage', EnglishConfigDefaults.reading_passage, READING_PASSAGE_FIELDS),
  {
    recordKey: 'job_flags.readingRefillEnabled',
    namespace: 'job_flags',
    path: 'readingRefillEnabled',
    category: 'reading',
    label: 'Bật Reading-Refill (scheduled)',
    description: 'Tắt sẽ bỏ qua các lần sinh reading tự động theo lịch bên dưới.',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.readingRefillEnabled,
    validation: boolField('Bật Reading-Refill (scheduled)'),
    uiSchema: boolField('Bật Reading-Refill (scheduled)'),
    sortOrder: 2200
  },
  {
    recordKey: 'job_flags.readingRefillMaxPerRun',
    namespace: 'job_flags',
    path: 'readingRefillMaxPerRun',
    category: 'reading',
    label: 'Max bài đọc / 1 lần Reading-Refill',
    description: 'Giới hạn tổng số reading passage sinh trong mỗi lần Reading-Refill chạy (tối ưu cost AI).',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.readingRefillMaxPerRun,
    validation: intField('Max bài đọc / 1 lần Reading-Refill', 1, undefined, 'bài'),
    uiSchema: intField('Max bài đọc / 1 lần Reading-Refill', 1, undefined, 'bài'),
    sortOrder: 2210
  },
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
    validation: cronScheduleField('Lịch chạy Reading-Refill'),
    uiSchema: cronScheduleField('Lịch chạy Reading-Refill'),
    sortOrder: 2220
  },

  // ── Câu hỏi đọc hiểu ───────────────────────────────────────────────────────
  ...numericRecords('reading_question', EnglishConfigDefaults.reading_question, READING_QUESTION_FIELDS),
  {
    recordKey: 'job_flags.readingQuestionRefillEnabled',
    namespace: 'job_flags',
    path: 'readingQuestionRefillEnabled',
    category: 'reading_question',
    label: 'Bật Reading-Question-Refill (scheduled)',
    description: 'Tắt sẽ bỏ qua các lần sinh câu hỏi đọc hiểu tự động theo lịch bên dưới.',
    recordType: 'boolean',
    defaultValue: EnglishConfigDefaults.job_flags.readingQuestionRefillEnabled,
    validation: boolField('Bật Reading-Question-Refill (scheduled)'),
    uiSchema: boolField('Bật Reading-Question-Refill (scheduled)'),
    sortOrder: 3200
  },
  {
    recordKey: 'job_flags.readingQuestionRefillMaxPerRun',
    namespace: 'job_flags',
    path: 'readingQuestionRefillMaxPerRun',
    category: 'reading_question',
    label: 'Max câu hỏi / 1 lần Reading-Question-Refill',
    description:
      'Giới hạn tổng số câu hỏi đọc hiểu sinh trong mỗi lần chạy (tối ưu cost AI). ' +
      'Mỗi bài đọc ăn "Số câu hỏi mỗi bài đọc" câu.',
    recordType: 'num',
    defaultValue: EnglishConfigDefaults.job_flags.readingQuestionRefillMaxPerRun,
    validation: intField('Max câu hỏi / 1 lần Reading-Question-Refill', 1, undefined, 'câu'),
    uiSchema: intField('Max câu hỏi / 1 lần Reading-Question-Refill', 1, undefined, 'câu'),
    sortOrder: 3210
  },
  {
    recordKey: 'reading_question_refill_schedule.items',
    namespace: 'reading_question_refill_schedule',
    path: 'items',
    category: 'reading_question',
    label: 'Lịch chạy Reading-Question-Refill (cron)',
    description:
      'Danh sách các mốc giờ chạy scheduled reading-question-refill. Đổi giá trị này sẽ reconcile lại ' +
      'BullMQ job schedulers ngay lập tức (thêm/xoá scheduler), không cần restart.',
    recordType: 'arr',
    defaultValue: EnglishConfigDefaults.reading_question_refill_schedule,
    validation: cronScheduleField('Lịch chạy Reading-Question-Refill'),
    uiSchema: cronScheduleField('Lịch chạy Reading-Question-Refill'),
    sortOrder: 3220
  }
];

export function buildDefaultEnglishConfigSnapshot(): EnglishConfigSnapshot {
  return {
    question_pool: QuestionPoolSchema.parse(EnglishConfigDefaults.question_pool),
    quiz_distribution: QuizDistributionSchema.parse(EnglishConfigDefaults.quiz_distribution),
    beginner_quiz_types: BeginnerQuizTypesSchema.parse(EnglishConfigDefaults.beginner_quiz_types),
    job_flags: JobFlagsSchema.parse(EnglishConfigDefaults.job_flags),
    pool_refill_schedule: PoolRefillScheduleSchema.parse(EnglishConfigDefaults.pool_refill_schedule),
    sibling_gen: SiblingGenSchema.parse(EnglishConfigDefaults.sibling_gen),
    sibling_gen_schedule: SiblingGenScheduleSchema.parse(EnglishConfigDefaults.sibling_gen_schedule),
    reading_passage: ReadingPassageSchema.parse(EnglishConfigDefaults.reading_passage),
    reading_refill_schedule: ReadingRefillScheduleSchema.parse(EnglishConfigDefaults.reading_refill_schedule),
    reading_question: ReadingQuestionSchema.parse(EnglishConfigDefaults.reading_question),
    reading_question_refill_schedule: ReadingQuestionRefillScheduleSchema.parse(
      EnglishConfigDefaults.reading_question_refill_schedule
    )
  };
}
