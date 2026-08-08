import { OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';
import _ from 'lodash';
import logger from '@/configs/logger.config';
import aiModelService from '@/core/services/ai/aiModel.service';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');

const openRouterClient = new OpenRouter({ apiKey: OPENROUTER_API_KEY });

export function getAIClient(): OpenRouter {
  return openRouterClient;
}

export const MODELS = {
  GEMINI_FLASH_LITE: 'google/gemini-2.5-flash-lite:nitro',
  GPT_4_1_NANO: 'openai/gpt-4.1-nano:nitro',
  GPT_4_O_MINI: 'openai/gpt-4o-mini:nitro',
  QWEN_3_5_FLASH: 'qwen/qwen3.5-flash-02-23',
  QWEN_3_6_35B_A3B: 'qwen/qwen3.6-35b-a3b:floor',
  QWEN_3_235B_A22B: 'qwen/qwen3-235b-a22b-2507:floor',
  DEEPSEEK_V3_2: 'deepseek/deepseek-v3.2:floor',
  DEEPSEEK_V4_FLASH: 'deepseek/deepseek-v4-flash:floor',
  GROK_4_1_FAST: 'x-ai/grok-4.1-fast:floor',
  MINIMAX_M2_5: 'minimax/minimax-m2.5:floor'
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];

/**
 * Context sinh câu hỏi. Mỗi model bật/tắt độc lập cho từng context và có provider
 * routing riêng — schedule dùng cho mọi đường tự động (cron refill + on-demand
 * backstop), manual chỉ cho admin trigger.
 */
export type ModelContext = 'schedule' | 'manual';

export interface ResolvedStudyModel {
  model: string;
  provider?: ProviderPreferencesJson;
}

export async function getStudyModelsForContext(context: ModelContext): Promise<ResolvedStudyModel[]> {
  const activeModels = await aiModelService.getActiveModels();
  const enabled = activeModels.filter((m) => (context === 'schedule' ? m.scheduleEnabled : m.manualEnabled));

  if (enabled.length === 0) {
    logger.warn(`[aiClient] No active models enabled for context=${context}, falling back to hardcoded MODELS`);
    return Object.values(MODELS).map((model) => ({ model }));
  }

  logger.info(`[aiClient] Active models (context=${context}): ${enabled.map((m) => m.modelId).join(', ')}`);
  return enabled.map((m) => ({
    model: m.modelId,
    provider: (context === 'schedule' ? m.scheduleProvider : m.manualProvider) ?? undefined
  }));
}

export async function pickStudyModelForContext(context: ModelContext): Promise<ResolvedStudyModel> {
  if (process.env.NODE_ENV === 'development') return { model: MODELS.GEMINI_FLASH_LITE };
  const candidates = await getStudyModelsForContext(context);
  return _.sample(candidates) ?? { model: MODELS.GPT_4_O_MINI };
}

/**
 * Model chỉ định sẵn vẫn cần provider routing của chính nó (không bỏ qua config
 * chỉ vì caller truyền modelId). Không truyền model → random theo context.
 */
export async function resolveStudyModel(context: ModelContext, explicitModelId?: string): Promise<ResolvedStudyModel> {
  if (!explicitModelId) return pickStudyModelForContext(context);
  const row = await aiModelService.getModelByModelId(explicitModelId);
  return {
    model: explicitModelId,
    provider: (context === 'schedule' ? row?.scheduleProvider : row?.manualProvider) ?? undefined
  };
}

interface StructuredOutputRequest {
  model: string;
  instructions?: string;
  input: string;
  maxOutputTokens?: number;
  temperature?: number;
  provider?: ProviderPreferencesJson;
}

export interface StructuredOutputUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface StructuredOutputResult<T> {
  data: T;
  usage?: StructuredOutputUsage;
}

export async function generateStructuredOutput<TSchema extends z.ZodObject<z.ZodRawShape>>(
  schema: TSchema,
  request: StructuredOutputRequest
): Promise<StructuredOutputResult<z.infer<TSchema>>> {
  const TOOL_NAME = 'structured_output';

  // Build messages: instructions → system, input → user
  const messages = [];
  if (request.instructions) {
    messages.push({ role: 'system' as const, content: request.instructions });
  }
  messages.push({ role: 'user' as const, content: request.input });

  // Zod schema → JSON Schema cho function parameters
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

  // Dùng chat.send non-stream để né lỗi parse SSE event-union của callModel.
  // toolChoice 'required' + 1 tool → model buộc gọi structured_output, SDK không auto-execute.
  const response = await openRouterClient.chat.send({
    chatRequest: {
      stream: false,
      model: request.model,
      messages,
      temperature: request.temperature,
      maxCompletionTokens: request.maxOutputTokens,
      provider: request.provider,
      tools: [
        {
          type: 'function' as const,
          function: {
            name: TOOL_NAME,
            description: 'Return structured output conforming to the required schema.',
            parameters: jsonSchema
          }
        }
      ],
      toolChoice: 'required'
    }
  });

  const usage: StructuredOutputUsage | undefined =
    response.usage && response.model
      ? {
          inputTokens: response.usage.promptTokens,
          outputTokens: response.usage.completionTokens,
          model: response.model.replace(/^(google|openai|anthropic|meta-llama|mistralai|qwen)\//, '')
        }
      : undefined;

  const message = response.choices?.[0]?.message;

  // arguments là JSON string → parse trước khi validate schema
  const toolCall = message?.toolCalls?.[0];
  if (toolCall?.function?.arguments) {
    const parsed = schema.safeParse(JSON.parse(toolCall.function.arguments));
    if (!parsed.success) {
      throw new Error(`[aiClient] Tool call arguments failed schema validation: ${parsed.error.message}`);
    }
    return { data: parsed.data, usage };
  }

  // Fallback: một số model (Qwen, ...) không gọi tool mà trả về JSON text trong content
  logger.warn(`[aiClient] Model did not use tool call, attempting JSON text fallback. model=${request.model}`);

  const rawText = typeof message?.content === 'string' ? message.content : '';

  // Strip <think>...</think> blocks (Qwen thinking models emit these before JSON)
  const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error('[aiClient] Model did not call structured output tool and returned no parseable JSON');
  }

  const jsonString = jsonMatch[1] ?? jsonMatch[0]!;
  const parsed = schema.safeParse(JSON.parse(jsonString));
  if (!parsed.success) {
    throw new Error(`[aiClient] Model JSON output failed schema validation: ${parsed.error.message}`);
  }

  return { data: parsed.data, usage };
}
