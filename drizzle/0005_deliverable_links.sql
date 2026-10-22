ALTER TABLE "session_deliverables" DROP CONSTRAINT "session_deliverables_kind";--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "deliverable_mode" SET DEFAULT 'optional';--> statement-breakpoint
ALTER TABLE "session_deliverables" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_deliverables" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "session_deliverables" ADD CONSTRAINT "session_deliverables_link" CHECK (("session_deliverables"."kind" = 'link') = ("session_deliverables"."url" is not null and "session_deliverables"."storage_key" is null));--> statement-breakpoint
ALTER TABLE "session_deliverables" ADD CONSTRAINT "session_deliverables_kind" CHECK ("session_deliverables"."kind" in ('pdf','image','docx','text','link'));