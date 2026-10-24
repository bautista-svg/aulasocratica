CREATE TABLE "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "skill_runs_status" CHECK ("skill_runs"."status" in ('running','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_runs_activity_idx" ON "skill_runs" USING btree ("activity_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_runs_one_running" ON "skill_runs" USING btree ("activity_id") WHERE "skill_runs"."status" = 'running';