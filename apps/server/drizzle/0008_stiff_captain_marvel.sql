ALTER TABLE "accounts" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "terms_version" text;