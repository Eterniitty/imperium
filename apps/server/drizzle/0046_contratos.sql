CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"offer_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" integer NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"credits" integer NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "contracts_emperor_offer_unique" UNIQUE("emperor_id","offer_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_emperor_id_idx" ON "contracts" USING btree ("emperor_id");