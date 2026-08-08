ALTER TABLE "ai_models" ADD COLUMN "scheduleEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "manualEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "scheduleProvider" jsonb;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "manualProvider" jsonb;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "pricePromptPerToken" double precision;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "priceCompletionPerToken" double precision;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "pricingRaw" jsonb;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "openrouterMeta" jsonb;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "pricingSyncedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "english_cron_job_buckets" ADD COLUMN "costUsd" double precision;--> statement-breakpoint
ALTER TABLE "english_cron_job_model_attempts" ADD COLUMN "costUsd" double precision;--> statement-breakpoint
ALTER TABLE "english_cron_job_runs" ADD COLUMN "costUsd" double precision;