CREATE TABLE "sieges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"colony_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"attacker_id" uuid NOT NULL,
	"defender_id" uuid,
	"seed" integer NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'advancing' NOT NULL,
	"attack" double precision DEFAULT 0 NOT NULL,
	"defense" double precision DEFAULT 0 NOT NULL,
	"defenders" integer DEFAULT 0 NOT NULL,
	"last_assault" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_tick_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "sieges_state" CHECK ("sieges"."state" IN ('advancing', 'contested', 'battle', 'ready')),
	CONSTRAINT "sieges_outcome" CHECK ("sieges"."outcome" IS NULL OR "sieges"."outcome" IN ('captured', 'broken', 'lifted', 'void')),
	CONSTRAINT "sieges_progress" CHECK ("sieges"."progress" >= 0 AND "sieges"."progress" <= 1)
);
--> statement-breakpoint
ALTER TABLE "colonies" ADD COLUMN "acquired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sieges" ADD CONSTRAINT "sieges_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sieges" ADD CONSTRAINT "sieges_attacker_id_emperors_id_fk" FOREIGN KEY ("attacker_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sieges" ADD CONSTRAINT "sieges_defender_id_emperors_id_fk" FOREIGN KEY ("defender_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sieges_active_colony_idx" ON "sieges" USING btree ("colony_id") WHERE "sieges"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sieges_attacker_idx" ON "sieges" USING btree ("attacker_id");--> statement-breakpoint
CREATE INDEX "sieges_defender_idx" ON "sieges" USING btree ("defender_id");--> statement-breakpoint
CREATE INDEX "sieges_system_idx" ON "sieges" USING btree ("system_id");