import type { z } from 'zod';

/**
 * Mock cho `generateStructuredOutput` — chokepoint DUY NHẤT gọi OpenRouter trong toàn hệ
 * thống (study.service, questionPoolReview.service, siblingQuestion.service đều đi qua nó).
 * Thay đúng chỗ này là chặn 100% chi phí LLM mà vẫn chạy thật toàn bộ validate/dedupe/insert
 * phía sau.
 *
 * Hàng đợi: mỗi lời gọi lấy responder kế tiếp. Hết hàng đợi mà không set `always()` thì THROW
 * — test quên enqueue sẽ đỏ ngay thay vì âm thầm gọi mạng thật.
 */

export interface LlmCall {
  model: string;
  provider?: unknown;
  instructions?: string;
  input: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface Responder {
  /** Trả data (đã hoặc chưa qua schema) hoặc throw. */
  run: (call: LlmCall) => { data: unknown; usage?: LlmUsage };
  /** false = bỏ qua schema.parse, dùng khi cố tình giả lập payload méo. */
  validate: boolean;
}

const DEFAULT_USAGE = { inputTokens: 100, outputTokens: 50 };

const queue: Responder[] = [];
let fallback: Responder | null = null;
const calls: LlmCall[] = [];

function usageFor(call: LlmCall, usage?: Partial<LlmUsage>): LlmUsage {
  return {
    inputTokens: usage?.inputTokens ?? DEFAULT_USAGE.inputTokens,
    outputTokens: usage?.outputTokens ?? DEFAULT_USAGE.outputTokens,
    model: usage?.model ?? call.model
  };
}

export const mockLLM = {
  /** Gọi trong beforeEach. Xoá hàng đợi + lịch sử call. */
  reset(): void {
    queue.length = 0;
    calls.length = 0;
    fallback = null;
  },

  /** Đẩy 1 response thành công vào hàng đợi. `data` được validate qua schema của call. */
  enqueue(data: unknown, usage?: Partial<LlmUsage>): void {
    queue.push({ run: (call) => ({ data, usage: usageFor(call, usage) }), validate: true });
  },

  /** Như enqueue nhưng BỎ QUA schema.parse — dùng để giả lập model trả payload méo. */
  enqueueRaw(data: unknown, usage?: Partial<LlmUsage>): void {
    queue.push({ run: (call) => ({ data, usage: usageFor(call, usage) }), validate: false });
  },

  /** Đẩy n response giống nhau (hoặc sinh theo index). */
  enqueueMany(count: number, factory: (index: number) => unknown, usage?: Partial<LlmUsage>): void {
    for (let i = 0; i < count; i += 1) this.enqueue(factory(i), usage);
  },

  /** Lời gọi kế tiếp sẽ throw. */
  fail(error: unknown = new Error('mockLLM: lỗi giả lập từ model')): void {
    queue.push({
      run: () => {
        throw error;
      },
      validate: false
    });
  },

  /** Response mặc định cho MỌI lời gọi sau khi hàng đợi cạn (không giới hạn số lần). */
  always(data: unknown, usage?: Partial<LlmUsage>): void {
    fallback = { run: (call) => ({ data, usage: usageFor(call, usage) }), validate: true };
  },

  /**
   * Như `always` nhưng response được TÍNH TỪ chính lời gọi.
   *
   * Cần cho pipeline reading question: server tự random loại câu hỏi rồi gọi model một lần
   * cho mỗi loại, nên fixture cố định sẽ lệch loại và bị `isValidReadingQuestionDraft` loại
   * cả bộ. Ở đây đọc loại từ `call.input` rồi trả đúng loại đó.
   */
  respond(factory: (call: LlmCall) => unknown, usage?: Partial<LlmUsage>): void {
    fallback = { run: (call) => ({ data: factory(call), usage: usageFor(call, usage) }), validate: true };
  },

  /** Lịch sử call — assert được cả prompt (vd locked values, danh sách title ALREADY USED). */
  get calls(): readonly LlmCall[] {
    return calls;
  },

  get callCount(): number {
    return calls.length;
  },

  lastCall(): LlmCall | undefined {
    return calls.at(-1);
  },

  /** Số response còn tồn trong hàng đợi — assert "không gọi LLM" chặt hơn callCount. */
  get pending(): number {
    return queue.length;
  }
};

/** Thay thân của generateStructuredOutput. setup.ts nối vào, test không gọi trực tiếp. */
export async function invokeMockedStructuredOutput(
  schema: z.ZodObject<z.ZodRawShape>,
  request: LlmCall
): Promise<{ data: unknown; usage?: LlmUsage }> {
  calls.push(request);

  const responder = queue.shift() ?? fallback;
  if (!responder) {
    throw new Error(
      `mockLLM: lời gọi LLM thứ ${calls.length} không có fixture (model=${request.model}). ` +
        'Dùng mockLLM.enqueue()/always() trong test. Không có đường gọi OpenRouter thật.'
    );
  }

  const { data, usage } = responder.run(request);
  if (!responder.validate) return { data, usage };

  // Hàm thật parse output qua zod trước khi trả — mock giữ đúng ràng buộc đó để fixture
  // không trôi khỏi schema thực tế.
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `mockLLM: fixture không khớp schema của call (model=${request.model}): ${parsed.error.message.slice(0, 400)}`
    );
  }
  return { data: parsed.data, usage };
}
