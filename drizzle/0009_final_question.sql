ALTER TABLE "activities" ADD COLUMN "ask_final_answer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "final_question" text DEFAULT '' NOT NULL;