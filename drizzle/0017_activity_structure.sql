ALTER TABLE "activities" ADD COLUMN "consignas" jsonb;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "presentation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "presentation_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "objectives_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "section_titles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD COLUMN "consigna_answers" jsonb DEFAULT '{}'::jsonb NOT NULL;