ALTER TABLE "classroom_courseworks" ALTER COLUMN "max_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_courseworks" ADD COLUMN "kind" text DEFAULT 'assignment' NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_courseworks" ADD CONSTRAINT "classroom_courseworks_kind" CHECK ("classroom_courseworks"."kind" in ('assignment', 'material'));--> statement-breakpoint
ALTER TABLE "classroom_courseworks" ADD CONSTRAINT "classroom_courseworks_points" CHECK ("classroom_courseworks"."kind" = 'material' or "classroom_courseworks"."max_points" is not null);