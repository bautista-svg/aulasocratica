CREATE TABLE "session_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"extracted_text" text DEFAULT '' NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_deliverables_kind" CHECK ("session_deliverables"."kind" in ('pdf','image','docx','text')),
	CONSTRAINT "session_deliverables_status" CHECK ("session_deliverables"."processing_status" in ('pending','processing','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "deliverable_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "deliverable_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_deliverables" ADD CONSTRAINT "session_deliverables_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_deliverables" ADD CONSTRAINT "session_deliverables_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_deliverables_session_unique" ON "session_deliverables" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_deliverables_storage_unique" ON "session_deliverables" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "session_deliverables_activity_idx" ON "session_deliverables" USING btree ("activity_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deliverable_mode" CHECK ("activities"."deliverable_mode" in ('off','optional','required'));