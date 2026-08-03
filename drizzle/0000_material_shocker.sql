CREATE TABLE "ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"modelId" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "ai_models_key_unique" UNIQUE("key"),
	CONSTRAINT "ai_models_modelId_unique" UNIQUE("modelId")
);
--> statement-breakpoint
CREATE TABLE "english_config_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"recordKey" text NOT NULL,
	"namespace" text NOT NULL,
	"path" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"recordTypeId" integer NOT NULL,
	"valueText" text,
	"valueNumber" double precision,
	"valueBoolean" boolean,
	"valueJson" jsonb,
	"defaultText" text,
	"defaultNumber" double precision,
	"defaultBoolean" boolean,
	"defaultJson" jsonb,
	"validation" jsonb NOT NULL,
	"uiSchema" jsonb NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "english_config_record_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "english_config_record_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "english_cron_job_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"runRefId" integer NOT NULL,
	"bucketKey" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"engLevel" text NOT NULL,
	"quizType" text NOT NULL,
	"optionCount" integer NOT NULL,
	"topicId" integer,
	"topicName" text,
	"requestedCount" integer DEFAULT 0 NOT NULL,
	"generatedCount" integer DEFAULT 0 NOT NULL,
	"insertedCount" integer DEFAULT 0 NOT NULL,
	"skippedCount" integer DEFAULT 0 NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"errorPhase" text,
	"errorMessage" text,
	"errorStack" text,
	"metadata" jsonb,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "english_cron_job_model_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"runRefId" integer NOT NULL,
	"bucketRefId" integer NOT NULL,
	"model" text NOT NULL,
	"attemptOrder" integer NOT NULL,
	"status" text NOT NULL,
	"requestedCount" integer DEFAULT 0 NOT NULL,
	"generatedCount" integer DEFAULT 0 NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"errorStack" text,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "english_cron_job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" text NOT NULL,
	"jobKey" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"queueName" text,
	"bullJobId" text,
	"bullJobName" text,
	"totalBuckets" integer DEFAULT 0 NOT NULL,
	"deficientBuckets" integer DEFAULT 0 NOT NULL,
	"succeededBuckets" integer DEFAULT 0 NOT NULL,
	"failedBuckets" integer DEFAULT 0 NOT NULL,
	"skippedBuckets" integer DEFAULT 0 NOT NULL,
	"requestedQuestions" integer DEFAULT 0 NOT NULL,
	"generatedQuestions" integer DEFAULT 0 NOT NULL,
	"insertedQuestions" integer DEFAULT 0 NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"errorPhase" text,
	"errorMessage" text,
	"errorStack" text,
	"metadata" jsonb,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "english_cron_job_runs_runId_unique" UNIQUE("runId")
);
--> statement-breakpoint
CREATE TABLE "english_question_pool" (
	"id" serial PRIMARY KEY NOT NULL,
	"quizType" text NOT NULL,
	"engLevel" text NOT NULL,
	"optionCount" integer NOT NULL,
	"questionData" text NOT NULL,
	"model" text NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"topicId" integer,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "english_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"displayName" text,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "english_topics_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowAllTopics" boolean DEFAULT false NOT NULL,
	"allowAllQuizTypes" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now(),
	CONSTRAINT "tenants_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tenant_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastUsedAt" timestamp,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	CONSTRAINT "tenant_api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tenant_quiz_type_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"quizType" text NOT NULL,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_topic_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"topicId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "english_config_records" ADD CONSTRAINT "english_config_records_recordTypeId_english_config_record_types_id_fk" FOREIGN KEY ("recordTypeId") REFERENCES "public"."english_config_record_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_cron_job_buckets" ADD CONSTRAINT "english_cron_job_buckets_runRefId_english_cron_job_runs_id_fk" FOREIGN KEY ("runRefId") REFERENCES "public"."english_cron_job_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_cron_job_buckets" ADD CONSTRAINT "english_cron_job_buckets_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_cron_job_model_attempts" ADD CONSTRAINT "english_cron_job_model_attempts_runRefId_english_cron_job_runs_id_fk" FOREIGN KEY ("runRefId") REFERENCES "public"."english_cron_job_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_cron_job_model_attempts" ADD CONSTRAINT "english_cron_job_model_attempts_bucketRefId_english_cron_job_buckets_id_fk" FOREIGN KEY ("bucketRefId") REFERENCES "public"."english_cron_job_buckets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_question_pool" ADD CONSTRAINT "english_question_pool_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_quiz_type_access" ADD CONSTRAINT "tenant_quiz_type_access_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_topic_access" ADD CONSTRAINT "tenant_topic_access_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_topic_access" ADD CONSTRAINT "tenant_topic_access_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "english_config_records_key_unique_idx" ON "english_config_records" USING btree ("recordKey");--> statement-breakpoint
CREATE INDEX "english_config_records_category_idx" ON "english_config_records" USING btree ("category");--> statement-breakpoint
CREATE INDEX "english_config_records_namespace_idx" ON "english_config_records" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "english_config_records_type_idx" ON "english_config_records" USING btree ("recordTypeId");--> statement-breakpoint
CREATE INDEX "english_cron_job_buckets_run_ref_idx" ON "english_cron_job_buckets" USING btree ("runRefId");--> statement-breakpoint
CREATE INDEX "english_cron_job_buckets_status_idx" ON "english_cron_job_buckets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "english_cron_job_buckets_bucket_key_idx" ON "english_cron_job_buckets" USING btree ("bucketKey");--> statement-breakpoint
CREATE INDEX "english_cron_job_model_attempts_run_ref_idx" ON "english_cron_job_model_attempts" USING btree ("runRefId");--> statement-breakpoint
CREATE INDEX "english_cron_job_model_attempts_bucket_ref_idx" ON "english_cron_job_model_attempts" USING btree ("bucketRefId");--> statement-breakpoint
CREATE INDEX "english_cron_job_model_attempts_status_idx" ON "english_cron_job_model_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "english_cron_job_runs_job_key_idx" ON "english_cron_job_runs" USING btree ("jobKey");--> statement-breakpoint
CREATE INDEX "english_cron_job_runs_status_idx" ON "english_cron_job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "english_cron_job_runs_started_at_idx" ON "english_cron_job_runs" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "idx_question_pool_bucket" ON "english_question_pool" USING btree ("engLevel","quizType","topicId");--> statement-breakpoint
CREATE INDEX "idx_question_pool_created_at" ON "english_question_pool" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "tenant_api_keys_tenant_id_idx" ON "tenant_api_keys" USING btree ("tenantId");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_quiz_type_access_tenant_type_unique_idx" ON "tenant_quiz_type_access" USING btree ("tenantId","quizType");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_topic_access_tenant_topic_unique_idx" ON "tenant_topic_access" USING btree ("tenantId","topicId");