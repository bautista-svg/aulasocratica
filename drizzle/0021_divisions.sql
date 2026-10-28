ALTER TABLE "classrooms" ADD COLUMN "division_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "division" text DEFAULT '' NOT NULL;