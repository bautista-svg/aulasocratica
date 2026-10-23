ALTER TABLE "aspect_analyses" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "aspect_analyses" ADD COLUMN "recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "aspect_analyses" ADD COLUMN "interventions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "aspect_analyses" ADD COLUMN "skills_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "skill_settings" jsonb;