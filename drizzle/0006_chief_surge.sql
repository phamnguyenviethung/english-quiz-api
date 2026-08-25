DROP INDEX "idx_reading_passages_bucket";--> statement-breakpoint
DROP INDEX "idx_reading_questions_bucket";--> statement-breakpoint
ALTER TABLE "english_reading_passages" ADD COLUMN "type" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "english_reading_questions" ADD COLUMN "type" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_reading_passages_bucket" ON "english_reading_passages" USING btree ("cefrLevel","topicId","type");--> statement-breakpoint
CREATE INDEX "idx_reading_questions_bucket" ON "english_reading_questions" USING btree ("cefrLevel","topicId","type");