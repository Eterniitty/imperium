CREATE TABLE "emperor_deaths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"cause" text NOT NULL,
	"killer" text,
	"streak" integer NOT NULL,
	"died_at" timestamp with time zone NOT NULL,
	"reborn_at" timestamp with time zone NOT NULL,
	"rebirth_kind" text,
	"rebirth_system_id" text,
	CONSTRAINT "emperor_deaths_cause" CHECK ("emperor_deaths"."cause" IN ('combat', 'battle')),
	CONSTRAINT "emperor_deaths_rebirth" CHECK ("emperor_deaths"."rebirth_kind" IS NULL OR "emperor_deaths"."rebirth_kind" IN ('cradle', 'core', 'heir'))
);
--> statement-breakpoint
CREATE TABLE "heirs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"colony_id" uuid NOT NULL,
	"name" text NOT NULL,
	"doctrine" text NOT NULL,
	"builds" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'gestating' NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heirs_state" CHECK ("heirs"."state" IN ('gestating', 'active')),
	CONSTRAINT "heirs_doctrine" CHECK ("heirs"."doctrine" IN ('prosperity', 'bastion', 'balanced'))
);
--> statement-breakpoint
ALTER TABLE "colonies" ADD COLUMN "governor" text;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "flagship_hull" double precision DEFAULT 400 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "dead_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "reborn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "rebirth_colony_id" uuid;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "death_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "last_death_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "incarnated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "preferred_cradle_id" uuid;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "heirs_born" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperor_deaths" ADD CONSTRAINT "emperor_deaths_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heirs" ADD CONSTRAINT "heirs_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heirs" ADD CONSTRAINT "heirs_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emperor_deaths_emperor_idx" ON "emperor_deaths" USING btree ("emperor_id","died_at");--> statement-breakpoint
CREATE UNIQUE INDEX "heirs_colony_idx" ON "heirs" USING btree ("colony_id");--> statement-breakpoint
CREATE INDEX "heirs_emperor_idx" ON "heirs" USING btree ("emperor_id");--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_dead_complete" CHECK (("emperors"."dead_at" IS NULL) = ("emperors"."reborn_at" IS NULL));--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_flagship_hull" CHECK ("emperors"."flagship_hull" >= 0);