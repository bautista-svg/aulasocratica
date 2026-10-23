ALTER TABLE "activities" ADD COLUMN "ask_reflection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "closing_message_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "closing_message" text DEFAULT '' NOT NULL;