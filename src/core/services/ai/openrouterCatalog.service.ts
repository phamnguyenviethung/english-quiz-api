import logger from '@/configs/logger.config';
import { getAIClient } from '@/configs/aiClient.config';

// Catalog = danh sách model công khai của OpenRouter (nguồn sự thật về giá).
// Khác với bảng ai_models (danh sách model ta chủ động bật để sinh câu hỏi).
export interface CatalogModelPricing {
  prompt: number | null;
  completion: number | null;
  request: number | null;
  image: number | null;
}

export interface CatalogModel {
  id: string;
  name: string;
  description: string | null;
  contextLength: number | null;
  pricing: CatalogModelPricing;
  supportedParameters: string[];
  topProvider: {
    contextLength: number | null;
    maxCompletionTokens: number | null;
    isModerated: boolean;
  } | null;
}

// OpenRouter trả giá dạng string USD/token ("0.00000015"), có model để "0" hoặc
// thiếu field → parse mềm, không hợp lệ thì null (không đoán bừa thành 0).
function parsePrice(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { models: CatalogModel[]; fetchedAt: number } | null = null;
// Gộp các request đồng thời vào 1 lần gọi OpenRouter thay vì mỗi request 1 lần.
let inFlight: Promise<CatalogModel[]> | null = null;

async function fetchCatalog(): Promise<CatalogModel[]> {
  const response = await getAIClient().models.list();
  const models: CatalogModel[] = response.data.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description ?? null,
    contextLength: model.contextLength,
    pricing: {
      prompt: parsePrice(model.pricing.prompt),
      completion: parsePrice(model.pricing.completion),
      request: parsePrice(model.pricing.request),
      image: parsePrice(model.pricing.image)
    },
    supportedParameters: model.supportedParameters.map(String),
    topProvider: model.topProvider
      ? {
          contextLength: model.topProvider.contextLength ?? null,
          maxCompletionTokens: model.topProvider.maxCompletionTokens ?? null,
          isModerated: model.topProvider.isModerated
        }
      : null
  }));
  logger.info(`[OpenRouterCatalog] Fetched ${models.length} models from OpenRouter`);
  return models;
}

async function getAllCatalogModels(): Promise<CatalogModel[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.models;
  if (inFlight) return inFlight;

  inFlight = fetchCatalog()
    .then((models) => {
      cache = { models, fetchedAt: Date.now() };
      return models;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (err) {
    // Catalog chết không được làm chết luôn admin UI / create model: trả cache cũ
    // nếu còn, hết cách mới ném lên.
    if (cache) {
      logger.warn(`[OpenRouterCatalog] Fetch failed, serving stale cache: ${err}`);
      return cache.models;
    }
    throw err;
  }
}

export async function listCatalogModels(opts: { search?: string } = {}): Promise<CatalogModel[]> {
  const models = await getAllCatalogModels();
  const search = opts.search?.trim().toLowerCase();
  if (!search) return models;
  return models.filter((model) => model.id.toLowerCase().includes(search) || model.name.toLowerCase().includes(search));
}

export async function getCatalogModel(modelId: string): Promise<CatalogModel | null> {
  const models = await getAllCatalogModels();
  // modelId trong ai_models có thể mang suffix routing (":nitro", ":floor") mà
  // catalog không có → so khớp cả bản đã bỏ suffix.
  const baseId = modelId.split(':')[0]!;
  return models.find((model) => model.id === modelId) ?? models.find((model) => model.id === baseId) ?? null;
}

export function invalidateCatalogCache(): void {
  cache = null;
}

export default {
  listCatalogModels,
  getCatalogModel,
  invalidateCatalogCache
};
