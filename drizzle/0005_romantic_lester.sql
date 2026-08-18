CREATE TABLE "english_reading_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"passageRefId" integer NOT NULL,
	"quizType" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"correctAnswer" integer NOT NULL,
	"explanation" text NOT NULL,
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
ALTER TABLE "english_reading_passages" ADD COLUMN "questionGenAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "english_reading_questions" ADD CONSTRAINT "english_reading_questions_passageRefId_english_reading_passages_id_fk" FOREIGN KEY ("passageRefId") REFERENCES "public"."english_reading_passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_reading_questions" ADD CONSTRAINT "english_reading_questions_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reading_questions_passage" ON "english_reading_questions" USING btree ("passageRefId");--> statement-breakpoint
CREATE INDEX "idx_reading_questions_bucket" ON "english_reading_questions" USING btree ("cefrLevel","topicId");--> statement-breakpoint
CREATE INDEX "idx_reading_questions_created_at" ON "english_reading_questions" USING btree ("createdAt");