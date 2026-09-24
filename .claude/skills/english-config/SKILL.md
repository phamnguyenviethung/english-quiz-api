---
name: english-config
description: Runtime config (english_config_records) of english-quiz-api — zod-validated namespaces with defaults, in-memory snapshot, change hooks, admin UI metadata (validation/uiSchema/category/sortOrder), /english/config* endpoints. Use when adding/changing any tunable (pool sizes, distribution, job flags, schedules, reading knobs) or reading config at runtime.
---

# English config

Full spec: `docs/english-config.md` (§5 records, §7 adding a config, §9 debugging).

## Rules
- Runtime code reads config **synchronously** via `getEnglishConfigSnapshot().<namespace>` — never query the config tables directly.
- Writes go through `updateEnglishConfig` / `updateEnglishConfigBulk` / `resetEnglishConfigToDefault` (transactional, validated, then snapshot refresh + `onEnglishConfigChanged` hooks).
- Subscribe to changes with `onEnglishConfigChanged('<namespace>.<path>', handler)` (e.g. cron jobs reconcile schedulers on `*_schedule.items`).
- Seeding: `ensureEnglishConfigSeeded()` runs at boot (`src/index.ts`).

## File map
| Concern | Path |
|---|---|
| Defaults, zod schemas, record definitions | `src/core/services/english/englishConfig.defaults.ts` (`EnglishConfigDefaults`, `ENGLISH_CONFIG_RECORD_DEFINITIONS`, `*_FIELDS` tables) |
| Service (snapshot, update, hooks) | `src/core/services/english/englishConfig.service.ts` |
| Tables | `englishConfigRecordType`, `englishConfigRecord` in `src/core/db/schema/main.ts` |
| Routes | `/english/config`, `/english/config/records` (GET/PATCH bulk), `/english/config/:recordKey` (PATCH), `/english/config/:recordKey/reset` — admin-only (`auth: { admin: true }`) in `english.route.ts` |

## Recipe: add a config (from docs §7)
1. Default in `EnglishConfigDefaults` (new namespace or field).
2. Zod schema in `englishConfig.defaults.ts`.
3. Record definition in `ENGLISH_CONFIG_RECORD_DEFINITIONS`. For the numeric namespaces (`question_pool`, `reading_passage`, `reading_question`) add the field to the `*_FIELDS` table (compile error otherwise).
4. `recordType`: `str | num | boolean | arr | obj`.
5. `validation` + `uiSchema` so the dashboard renders typed controls; `min`/`max` **must match zod**. Optional `unit`, `display: 'percent'` (stored 0..1, shown 0..100).
6. `category` (`questions` / `reading` / `reading_question`) and `sortOrder` = pipeline base (1000/2000/3000) + section base (0 thresholds, 50 distribution, 100 manual, 200 auto & cron) + index.
7. Read it via `getEnglishConfigSnapshot()`.
8. Update `docs/english-config.md` + the related domain doc.
9. The dashboard `config` feature renders records generically; check it still renders (see dashboard `config` skill).

## Tests
Unit `config-schema`; integration `english-config`; e2e `j3-admin-config`. In tests change config with `setConfig({...})` and `disableAllJobs()` from `test/helpers/config.helper.ts`; `resetDb()` restores defaults.
