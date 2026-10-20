CREATE TABLE "emperors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"system_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emperors_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "emperors_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;