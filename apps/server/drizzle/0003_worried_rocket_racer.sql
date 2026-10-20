CREATE TABLE "fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"system_id" text NOT NULL,
	"dest_system_id" text,
	"depart_at" timestamp with time zone,
	"arrive_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleets_emperor_number_unique" UNIQUE("emperor_id","number"),
	CONSTRAINT "fleets_travel_complete" CHECK (("fleets"."dest_system_id" IS NULL) = ("fleets"."depart_at" IS NULL) AND ("fleets"."depart_at" IS NULL) = ("fleets"."arrive_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "scheduled_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"class_id" text NOT NULL,
	"hull" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ships" ADD CONSTRAINT "ships_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_events_due_at_idx" ON "scheduled_events" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "ships_fleet_id_idx" ON "ships" USING btree ("fleet_id");--> statement-breakpoint
-- Los Emperadores creados antes de las flotas reciben la flota inicial (un
-- explorador, casco 60 según packages/content) en el sistema donde están.
INSERT INTO "fleets" ("emperor_id", "number", "system_id")
SELECT "id", 1, CASE WHEN "arrive_at" IS NOT NULL AND "arrive_at" <= now() THEN "dest_system_id" ELSE "system_id" END
FROM "emperors" e
WHERE NOT EXISTS (SELECT 1 FROM "fleets" f WHERE f."emperor_id" = e."id");--> statement-breakpoint
INSERT INTO "ships" ("fleet_id", "class_id", "hull")
SELECT f."id", 'explorer', 60
FROM "fleets" f
WHERE NOT EXISTS (SELECT 1 FROM "ships" s WHERE s."fleet_id" = f."id");
