CREATE TABLE "classroom_connections" (
	"teacher_id" uuid PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_courseworks" (
	"activity_id" uuid PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"course_name" text DEFAULT '' NOT NULL,
	"coursework_id" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"max_points" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_grades" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"google_user_id" text NOT NULL,
	"grade" real NOT NULL,
	"returned" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_student_links" (
	"student_id" uuid NOT NULL,
	"course_id" text NOT NULL,
	"google_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classroom_connections" ADD CONSTRAINT "classroom_connections_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_courseworks" ADD CONSTRAINT "classroom_courseworks_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_courseworks" ADD CONSTRAINT "classroom_courseworks_created_by_teachers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_grades" ADD CONSTRAINT "classroom_grades_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_student_links" ADD CONSTRAINT "classroom_student_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_student_links_unique" ON "classroom_student_links" USING btree ("student_id","course_id");