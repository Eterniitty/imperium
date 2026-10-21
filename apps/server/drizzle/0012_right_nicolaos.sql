CREATE TABLE "alien_claims" (
	"system_id" text PRIMARY KEY NOT NULL,
	"faction_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alien_fleets" (
	"fleet_id" uuid PRIMARY KEY NOT NULL,
	"region_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alien_regions" (
	"region_key" text PRIMARY KEY NOT NULL,
	"faction_id" text NOT NULL,
	"active_until" timestamp with time zone NOT NULL,
	"ticking" boolean DEFAULT false NOT NULL,
	"last_spawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alien_standings" (
	"emperor_id" uuid NOT NULL,
	"faction_id" text NOT NULL,
	"grudge" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alien_standings_emperor_id_faction_id_pk" PRIMARY KEY("emperor_id","faction_id"),
	CONSTRAINT "alien_standings_grudge" CHECK ("alien_standings"."grudge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "emperors" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "kind" text DEFAULT 'player' NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "faction_id" text;--> statement-breakpoint
ALTER TABLE "alien_fleets" ADD CONSTRAINT "alien_fleets_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alien_standings" ADD CONSTRAINT "alien_standings_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alien_claims_faction_idx" ON "alien_claims" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "alien_fleets_region_idx" ON "alien_fleets" USING btree ("region_key");--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_faction_id_unique" UNIQUE("faction_id");--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_kind" CHECK ("emperors"."kind" IN ('player', 'ai', 'alien') AND ("emperors"."kind" = 'player') = ("emperors"."account_id" IS NOT NULL) AND ("emperors"."kind" = 'alien') = ("emperors"."faction_id" IS NOT NULL));