CREATE TABLE "english_question_pool_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"poolQuestionRefId" integer NOT NULL,
	"quizType" text NOT NULL,
	"engLevel" text NOT NULL,
	"optionCount" integer NOT NULL,
	"topicId" integer,
	"topicName" text,
	"originalData" text NOT NULL,
	"revisedData" text NOT NULL,
	"verdict" text,
	"summary" text,
	"score" integer,
	"checklist" jsonb,
	"issues" jsonb,
	"changedFields" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"reviewModel" text NOT NULL,
	"tokenIn" integer DEFAULT 0 NOT NULL,
	"tokenOut" integer DEFAULT 0 NOT NULL,
	"resolvedByUserId" text,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "english_question_pool" ADD COLUMN "updatedAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "english_question_pool_reviews" ADD CONSTRAINT "english_question_pool_reviews_poolQuestionRefId_english_question_pool_id_fk" FOREIGN KEY ("poolQuestionRefId") REFERENCES "public"."english_question_pool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_question_pool_reviews" ADD CONSTRAINT "english_question_pool_reviews_topicId_english_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."english_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pool_reviews_status" ON "english_question_pool_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pool_reviews_pool_ref" ON "english_question_pool_reviews" USING btree ("poolQuestionRefId");--> statement-breakpoint
CREATE INDEX "idx_pool_reviews_bucket" ON "english_question_pool_reviews" USING btree ("engLevel","quizType","topicId");--> statement-breakpoint
CREATE INDEX "idx_pool_reviews_created_at" ON "english_question_pool_reviews" USING btree ("createdAt");