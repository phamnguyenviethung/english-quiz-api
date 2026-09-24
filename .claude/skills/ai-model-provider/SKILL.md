---
name: ai-model-provider
description: AI model registry and OpenRouter provider routing in english-quiz-api — ai_models CRUD, per-context enable flags (schedule/manual/reading), provider preferences (jsonb vs normalized tables), pricing sync, OpenRouter catalog cache, cost computation. Use when touching aiModel.service.ts, openrouterCatalog.service.ts, providerPref.mapper.ts, model selection in aiClient.config.ts or /admin/models*.
---

# AI model / provider

Full spec: `docs/ai-model-provider.md`.

## Rules
- `ModelContext`: `schedule` (cron refill + on-demand), `manual` (admin refill/review/sibling), `reading` (passages + reading questions). Each has an enable column (`scheduleEnabled`, `manualEnabled`, `readingEnabled`).
- Provider preferences — **two storage shapes, one API shape**:
  - `schedule` / `manual`: jsonb columns `scheduleProvider` / `manualProvider` on `ai_models` (validated with `normalizeProviderPreferencesJson`).
  - `reading`: normalized tables `ai_model_provider_prefs` + `ai_model_provider_pref_values` (via `fromProviderPreferences`).
  - Both use the same validation in `providerPref.mapper.ts`; the API always sends/returns the nested object.
- Unique violations map to `ConflictException` via `toConflictError()` in the service.
- Pricing sync pulls from the OpenRouter catalog (in-memory TTL cache, `invalidateCatalogCache()`).
- Cost: `computeCostUsd(model, tokenIn, tokenOut)`, `sumCostUsd`.

## File map
| Concern | Path |
|---|---|
| Model CRUD, pricing, cost | `src/core/services/ai/aiModel.service.ts` |
| OpenRouter catalog | `src/core/services/ai/openrouterCatalog.service.ts` |
| Provider pref mapping | `src/core/services/ai/providerPref.mapper.ts` |
| Model selection at call time | `src/configs/aiClient.config.ts` (`resolveStudyModel(s)`, `pickStudyModelForContext`, `getStudyModelsForContext`) |
| Tables | `aiModel`, `aiModelProviderPref`, `aiModelProviderPrefValue` in `src/core/db/schema/main.ts` |
| Seed | `src/core/db/seeds/ai-models.seed.ts` (`bun run db:seed:ai-models`) |
| Routes | `/admin/models` (GET/POST), `/admin/models/catalog`, `/admin/models/:id` (GET/PATCH), `/admin/models/:id/sync`, `/admin/models/sync-all`; `/english/pool/models` (usage per model) |

## Recipe: new provider preference field
Add to the `ProviderPreferences` shape + mapper (both directions), the normalized table columns (reading) — no migration files — request TypeBox (`ProviderPreferencesSchema` in `src/api/common/schemas.ts`) and response schema, docs, dashboard `ai-models` form (`provider-preferences` util).

## Tests
Integration `ai-model-provider`; unit `provider-pref`, `cost`.
