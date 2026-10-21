CREATE TABLE "companion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "companion_requests_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "companion_requests_status" CHECK ("companion_requests"."status" IN ('pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "companion_requests" ADD CONSTRAINT "companion_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_requests" ADD CONSTRAINT "companion_requests_target_id_emperors_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companion_requests_target_id_idx" ON "companion_requests" USING btree ("target_id");