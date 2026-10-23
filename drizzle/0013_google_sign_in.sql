ALTER TABLE "teachers" ADD COLUMN "google_sub" text;--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_google_sub_unique" ON "teachers" USING btree ("google_sub");