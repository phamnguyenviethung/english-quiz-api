CREATE TABLE "ai_model_provider_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelRefId" integer NOT NULL,
	"context" text DEFAULT 'reading' NOT NULL,
	"allowFallbacks" boolean,
	"requireParameters" boolean,
	"dataCollection" text,
	"sort" text,
	"zdr" boolean,
	"maxPricePrompt" double precision,
	"maxPriceCompletion" double precision,
	"maxPriceRequest" double precision,
	"maxPriceImage" double precision,
	"maxPriceAudio" double precision,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_model_provider_pref_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"prefRefId" integer NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "english_reading_passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"paragraphs" jsonb NOT NULL,
	"wordCount" integer NOT NULL,
	"cefrLevel" text NOT NULL,
	"topicId" integer,
	"topicName" text,
	"model" text NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "readingEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_provider_prefs" ADD CONSTRAINT "ai_model_provider_prefs_modelRefId_ai_models_id_fk" FOREIGN KEY ("modelRefId") REFERENCES "public"."ai_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_provider_pref_values" ADD CONSTRAINT "ai_model_provider_pref_values_prefRefId_ai_model_provider_prefs_id_fk" FOREIGN KEY ("prefRefId") REFERENCES "public"."ai_model_provider_prefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_reading_passages" ADD CONSTRAINT "english_reading_passages_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_provider_prefs_model_context_unique_idx" ON "ai_model_provider_prefs" USING btree ("modelRefId","context");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_provider_pref_values_unique_idx" ON "ai_model_provider_pref_values" USING btree ("prefRefId","kind","value");--> statement-breakpoint
CREATE INDEX "ai_model_provider_pref_values_pref_idx" ON "ai_model_provider_pref_values" USING btree ("prefRefId");--> statement-breakpoint
CREATE INDEX "idx_reading_passages_bucket" ON "english_reading_passages" USING btree ("cefrLevel","topicId");--> statement-breakpoint
CREATE INDEX "idx_reading_passages_created_at" ON "english_reading_passages" USING btree ("createdAt");