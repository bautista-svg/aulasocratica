CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"objectives" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"tutor_type" text DEFAULT 'pensamiento_critico' NOT NULL,
	"help_level" text DEFAULT 'moderate' NOT NULL,
	"tutor_rules" text DEFAULT '' NOT NULL,
	"tutor_id" uuid,
	"require_initial_answer" boolean DEFAULT true NOT NULL,
	"voice_language" text DEFAULT 'off' NOT NULL,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reflection_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"link_token" text NOT NULL,
	"link_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_title_len" CHECK (char_length("activities"."title") between 1 and 160),
	CONSTRAINT "activities_status" CHECK ("activities"."status" in ('draft','published','archived')),
	CONSTRAINT "activities_help_level" CHECK ("activities"."help_level" in ('autonomous','moderate','intensive')),
	CONSTRAINT "activities_voice_language" CHECK ("activities"."voice_language" in ('off','es','en'))
);
--> statement-breakpoint
CREATE TABLE "activity_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"extracted_text" text DEFAULT '' NOT NULL,
	"teacher_note" text DEFAULT '' NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_files_kind" CHECK ("activity_files"."kind" in ('pdf','image','audio','docx','text')),
	CONSTRAINT "activity_files_status" CHECK ("activity_files"."processing_status" in ('pending','processing','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid,
	"activity_id" uuid,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid,
	"action" text NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"entity_id" uuid,
	"ip" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"builtin_key" text,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'academica' NOT NULL,
	"severity" text DEFAULT 'review' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_alerts_category" CHECK ("classroom_alerts"."category" in ('academica','conducta','seguridad','integridad')),
	CONSTRAINT "classroom_alerts_severity" CHECK ("classroom_alerts"."severity" in ('review','immediate'))
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"name" text NOT NULL,
	"school" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"division" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classrooms_name_len" CHECK (char_length("classrooms"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"initial_answer" text,
	"final_answer" text,
	"reflection" jsonb,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"resume_code" text NOT NULL,
	"ended_by_teacher" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "learning_sessions_status" CHECK ("learning_sessions"."status" in ('in_progress','completed'))
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"file_kind" text,
	"storage_key" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"page_count" integer,
	"url" text,
	"body" text DEFAULT '' NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"processing_status" text DEFAULT 'ready' NOT NULL,
	"processing_error" text,
	"folder" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_kind" CHECK ("materials"."kind" in ('file','link','text')),
	CONSTRAINT "materials_title_len" CHECK (char_length("materials"."title") between 1 and 200),
	CONSTRAINT "materials_status" CHECK ("materials"."processing_status" in ('pending','processing','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"input_mode" text DEFAULT 'text' NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role" CHECK ("messages"."role" in ('user','assistant')),
	CONSTRAINT "messages_input_mode" CHECK ("messages"."input_mode" in ('text','voice'))
);
--> statement-breakpoint
CREATE TABLE "pedagogical_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source" text DEFAULT 'observed' NOT NULL,
	"message_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pedagogical_events_source" CHECK ("pedagogical_events"."source" in ('observed','inferred'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"narrative" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_kind" CHECK ("reports"."kind" in ('individual','group','overview')),
	CONSTRAINT "reports_status" CHECK ("reports"."status" in ('draft','validated')),
	CONSTRAINT "reports_title_len" CHECK (char_length("reports"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "rubric_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"rubric_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_suggestion" jsonb,
	"ai_generated_at" timestamp with time zone,
	"teacher_levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"teacher_comment" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_assessments_status" CHECK ("rubric_assessments"."status" in ('suggested','confirmed'))
);
--> statement-breakpoint
CREATE TABLE "session_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"basis" text[] DEFAULT '{}'::text[] NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"message_id" uuid,
	"classroom_alert_id" uuid,
	"alert_key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_alerts_status" CHECK ("student_alerts"."status" in ('open','reviewed','dismissed')),
	CONSTRAINT "student_alerts_severity" CHECK ("student_alerts"."severity" in ('review','immediate'))
);
--> statement-breakpoint
CREATE TABLE "student_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"name_key" text NOT NULL,
	"self_registered" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_full_name_len" CHECK (char_length("students"."full_name") between 2 and 120)
);
--> statement-breakpoint
CREATE TABLE "teacher_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text,
	"password_hash" text,
	"recovery_code_hash" text,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"tutors_seeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teachers_display_name_len" CHECK (char_length("teachers"."display_name") <= 80)
);
--> statement-breakpoint
CREATE TABLE "thinking_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"preset_key" text,
	"name" text NOT NULL,
	"tutor_type" text DEFAULT 'pensamiento_critico' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"student_age" text DEFAULT '' NOT NULL,
	"objectives" text DEFAULT '' NOT NULL,
	"question_style" text DEFAULT '' NOT NULL,
	"difficulty" text DEFAULT 'intermedia' NOT NULL,
	"help_level" text DEFAULT 'moderate' NOT NULL,
	"strategies" text DEFAULT '' NOT NULL,
	"closing_criteria" text DEFAULT '' NOT NULL,
	"rules" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutors_name_len" CHECK (char_length("tutors"."name") between 1 and 120),
	CONSTRAINT "tutors_help_level" CHECK ("tutors"."help_level" in ('autonomous','moderate','intensive')),
	CONSTRAINT "tutors_difficulty" CHECK ("tutors"."difficulty" in ('basica','intermedia','avanzada'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tutor_id_tutors_id_fk" FOREIGN KEY ("tutor_id") REFERENCES "public"."tutors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_files" ADD CONSTRAINT "activity_files_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_alerts" ADD CONSTRAINT "classroom_alerts_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedagogical_events" ADD CONSTRAINT "pedagogical_events_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedagogical_events" ADD CONSTRAINT "pedagogical_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_assessments" ADD CONSTRAINT "rubric_assessments_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_summaries" ADD CONSTRAINT "session_summaries_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_alerts" ADD CONSTRAINT "student_alerts_classroom_alert_id_classroom_alerts_id_fk" FOREIGN KEY ("classroom_alert_id") REFERENCES "public"."classroom_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_tokens" ADD CONSTRAINT "student_tokens_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_sessions" ADD CONSTRAINT "teacher_sessions_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thinking_analyses" ADD CONSTRAINT "thinking_analyses_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutors" ADD CONSTRAINT "tutors_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_link_token_unique" ON "activities" USING btree ("link_token");--> statement-breakpoint
CREATE INDEX "activities_classroom_idx" ON "activities" USING btree ("classroom_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_teacher_idx" ON "activities" USING btree ("teacher_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_files_storage_unique" ON "activity_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "activity_files_activity_idx" ON "activity_files" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "ai_usage_teacher_created_idx" ON "ai_usage" USING btree ("teacher_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_ip_idx" ON "audit_logs" USING btree ("action","ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_alerts_builtin_unique" ON "classroom_alerts" USING btree ("classroom_id","builtin_key");--> statement-breakpoint
CREATE INDEX "classroom_alerts_classroom_idx" ON "classroom_alerts" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "classrooms_teacher_idx" ON "classrooms" USING btree ("teacher_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_sessions_activity_student_unique" ON "learning_sessions" USING btree ("activity_id","student_id");--> statement-breakpoint
CREATE INDEX "learning_sessions_student_idx" ON "learning_sessions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "materials_teacher_idx" ON "materials" USING btree ("teacher_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_session_created_idx" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "pedagogical_events_session_created_idx" ON "pedagogical_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "pedagogical_events_session_type_idx" ON "pedagogical_events" USING btree ("session_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "reports_teacher_idx" ON "reports" USING btree ("teacher_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_assessments_session_unique" ON "rubric_assessments" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_summaries_session_unique" ON "session_summaries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "student_alerts_activity_idx" ON "student_alerts" USING btree ("activity_id","created_at");--> statement-breakpoint
CREATE INDEX "student_alerts_session_idx" ON "student_alerts" USING btree ("session_id","alert_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_tokens_hash_unique" ON "student_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "student_tokens_session_idx" ON "student_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_classroom_name_unique" ON "students" USING btree ("classroom_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_sessions_token_unique" ON "teacher_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "teacher_sessions_teacher_idx" ON "teacher_sessions" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_email_unique" ON "teachers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "teachers_last_seen_idx" ON "teachers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "thinking_analyses_session_unique" ON "thinking_analyses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tutors_teacher_idx" ON "tutors" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tutors_teacher_preset_unique" ON "tutors" USING btree ("teacher_id","preset_key") WHERE "tutors"."preset_key" is not null;