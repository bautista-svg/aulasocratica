CREATE TABLE "activity_student_code" (
	"activity_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by" text DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_student_code_by" CHECK ("activity_student_code"."uploaded_by" in ('student', 'teacher'))
);
--> statement-breakpoint
CREATE TABLE "code_defense_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid,
	"file" text NOT NULL,
	"from_line" integer NOT NULL,
	"to_line" integer NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"change" jsonb,
	"question" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"verdict" text,
	"reason" text DEFAULT '' NOT NULL,
	"quote" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "code_defense_checks_verdict" CHECK ("code_defense_checks"."verdict" is null or "code_defense_checks"."verdict" in ('explained', 'partial', 'not_explained'))
);
--> statement-breakpoint
ALTER TABLE "activity_student_code" ADD CONSTRAINT "activity_student_code_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_student_code" ADD CONSTRAINT "activity_student_code_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_defense_checks" ADD CONSTRAINT "code_defense_checks_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_defense_checks" ADD CONSTRAINT "code_defense_checks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_student_code_unique" ON "activity_student_code" USING btree ("activity_id","student_id");--> statement-breakpoint
CREATE INDEX "code_defense_checks_session_idx" ON "code_defense_checks" USING btree ("session_id","created_at");