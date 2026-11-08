CREATE TABLE "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_sends_recipient_kind_sent_at_idx" ON "email_sends" USING btree ("recipient","kind","sent_at");--> statement-breakpoint
CREATE INDEX "email_sends_sent_at_idx" ON "email_sends" USING btree ("sent_at");