CREATE TABLE "mercenary_contracts" (
	"fleet_id" uuid PRIMARY KEY NOT NULL,
	"emperor_id" uuid NOT NULL,
	"offer_id" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mercenary_contracts" ADD CONSTRAINT "mercenary_contracts_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mercenary_contracts" ADD CONSTRAINT "mercenary_contracts_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mercenary_contracts_emperor_id_idx" ON "mercenary_contracts" USING btree ("emperor_id");