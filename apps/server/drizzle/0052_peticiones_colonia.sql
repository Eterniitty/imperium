CREATE TABLE "colony_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"colony_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource" text,
	"amount" integer NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "colony_requests" ADD CONSTRAINT "colony_requests_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colony_requests" ADD CONSTRAINT "colony_requests_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "colony_requests_emperor_id_idx" ON "colony_requests" USING btree ("emperor_id");