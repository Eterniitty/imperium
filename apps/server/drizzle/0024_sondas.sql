CREATE TABLE "probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"from_x" double precision NOT NULL,
	"from_y" double precision NOT NULL,
	"from_z" double precision NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "probes" ADD CONSTRAINT "probes_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "probes_emperor_id_idx" ON "probes" USING btree ("emperor_id");