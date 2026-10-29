ALTER TABLE "activities" ADD COLUMN "tutor_max_questions" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "tutor_stop_when_achieved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD COLUMN "tutor_achieved_at" timestamp with time zone;