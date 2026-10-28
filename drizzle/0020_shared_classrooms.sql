CREATE TABLE "classroom_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" uuid NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "classroom_invites_role" CHECK ("classroom_invites"."role" in ('admin', 'editor', 'reader'))
);
--> statement-breakpoint
CREATE TABLE "classroom_members" (
	"classroom_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_members_role" CHECK ("classroom_members"."role" in ('admin', 'editor', 'reader'))
);
--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_created_by_teachers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_used_by_teachers_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_invited_by_teachers_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_invites_token_unique" ON "classroom_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "classroom_invites_classroom_idx" ON "classroom_invites" USING btree ("classroom_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_members_unique" ON "classroom_members" USING btree ("classroom_id","teacher_id");--> statement-breakpoint
CREATE INDEX "classroom_members_teacher_idx" ON "classroom_members" USING btree ("teacher_id");