CREATE TABLE "colonies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"planet_index" integer NOT NULL,
	"name" text,
	"population" double precision NOT NULL,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"founded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "colonies_planet_unique" UNIQUE("system_id","planet_index"),
	CONSTRAINT "colonies_stock_nonnegative" CHECK ("colonies"."population" >= 0 AND "colonies"."metal" >= 0 AND "colonies"."volatiles" >= 0 AND "colonies"."crystal" >= 0 AND "colonies"."alloys" >= 0)
);
--> statement-breakpoint
CREATE TABLE "colony_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"colony_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"finish_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "colony_builds_kind" CHECK ("colony_builds"."kind" IN ('installation', 'ship'))
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"colony_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"emperor_id" uuid,
	"colony_id" uuid,
	"reason" text NOT NULL,
	"ref" text,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"humans" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "humans" double precision DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "humans_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "humans" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "colonies" ADD CONSTRAINT "colonies_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "colony_builds" ADD CONSTRAINT "colony_builds_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "colonies_emperor_id_idx" ON "colonies" USING btree ("emperor_id");--> statement-breakpoint
CREATE INDEX "colony_builds_colony_id_idx" ON "colony_builds" USING btree ("colony_id","seq");--> statement-breakpoint
CREATE INDEX "installations_colony_id_idx" ON "installations" USING btree ("colony_id");--> statement-breakpoint
CREATE INDEX "resource_ledger_colony_id_idx" ON "resource_ledger" USING btree ("colony_id");--> statement-breakpoint
CREATE INDEX "resource_ledger_emperor_id_idx" ON "resource_ledger" USING btree ("emperor_id");--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_humans_nonnegative" CHECK ("emperors"."humans" >= 0);--> statement-breakpoint
ALTER TABLE "ships" ADD CONSTRAINT "ships_humans_nonnegative" CHECK ("ships"."humans" >= 0);--> statement-breakpoint
-- Añadido a mano: el libro de recursos es solo inserción (no se modifican ni borran asientos).
CREATE FUNCTION "resource_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'resource_ledger es solo inserción';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "resource_ledger_append_only" BEFORE UPDATE OR DELETE ON "resource_ledger" FOR EACH ROW EXECUTE FUNCTION "resource_ledger_append_only"();