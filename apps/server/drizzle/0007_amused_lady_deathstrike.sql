CREATE TABLE "fleet_cargo" (
	"fleet_id" uuid PRIMARY KEY NOT NULL,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"humans" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fleet_cargo_nonnegative" CHECK ("fleet_cargo"."metal" >= 0 AND "fleet_cargo"."volatiles" >= 0 AND "fleet_cargo"."crystal" >= 0 AND "fleet_cargo"."alloys" >= 0 AND "fleet_cargo"."humans" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_routes" (
	"fleet_id" uuid PRIMARY KEY NOT NULL,
	"from_colony_id" uuid NOT NULL,
	"to_colony_id" uuid NOT NULL,
	"carry" jsonb NOT NULL,
	"humans" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_cargo" ADD CONSTRAINT "fleet_cargo_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_from_colony_id_colonies_id_fk" FOREIGN KEY ("from_colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_routes" ADD CONSTRAINT "fleet_routes_to_colony_id_colonies_id_fk" FOREIGN KEY ("to_colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;