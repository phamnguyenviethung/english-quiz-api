---
name: topics
description: English topics in english-quiz-api — english_topics CRUD, active/beginner flags, random topic pairs for clients, tenant topic allow-list checks. Use when touching topic.service.ts or /english/topics*.
---

# Topics

## Rules
- Topics are global data (no tenant ownership). Tenants are restricted by allow-list: call `assertTopicAllowed(tenant, topicId)` (`src/api/plugins/tenantAuth.plugin.ts`) whenever a tenant route takes a `topicId`.
- `isActive` controls whether refill scans include the topic; `forBeginner` enables beginner buckets (see `beginner` skill).
- `topicId = null` buckets are valid in the pool (no topic).

## File map
| Concern | Path |
|---|---|
| Service | `src/core/services/english/topic.service.ts` (`getAllActiveTopics`, `getActiveBeginnerTopics`, `getTopicById`, `createTopic`, `updateTopic`, `deleteTopic`, `getRandomTopics`, `getRandomTopicPairs`, `getRandomTopicPairsFromPool`) |
| Table | `englishTopic` in `src/core/db/schema/main.ts` |
| Routes | `GET/POST /english/topics`, `PATCH /english/topics/:id`, `GET /english/topics/random-pairs` in `english.route.ts` |
| Tenant grants | `/admin/tenants/:id/topics` (see `tenant-auth`) |

## Gotchas
- There is no dedicated doc for topics; document behaviour changes in the doc of the feature that uses them (`question-pool.md`, `beginner.md`, `tenant-auth.md`).

## Tests
Integration `topic`; helper `createTopic()` in `test/helpers/seed.helper.ts`.
