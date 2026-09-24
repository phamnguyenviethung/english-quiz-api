DROP INDEX "idx_question_pool_bucket";--> statement-breakpoint
DROP INDEX "idx_reading_passages_bucket";--> statement-breakpoint
DROP INDEX "idx_reading_questions_bucket";--> statement-breakpoint
ALTER TABLE "english_question_pool" ADD COLUMN "forBeginner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "english_question_pool_reviews" ADD COLUMN "forBeginner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "english_reading_passages" ADD COLUMN "forBeginner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "english_reading_questions" ADD COLUMN "forBeginner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "english_topics" ADD COLUMN "forBeginner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_question_pool_bucket" ON "english_question_pool" USING btree ("engLevel","quizType","topicId","forBeginner");--> statement-breakpoint
CREATE INDEX "idx_reading_passages_bucket" ON "english_reading_passages" USING btree ("cefrLevel","topicId","type","forBeginner");--> statement-breakpoint
CREATE INDEX "idx_reading_questions_bucket" ON "english_reading_questions" USING btree ("cefrLevel","topicId","type","forBeginner");