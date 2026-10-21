CREATE TABLE "battle_rounds" (
	"battle_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_rounds_battle_id_round_pk" PRIMARY KEY("battle_id","round")
);
--> statement-breakpoint
CREATE TABLE "battle_sides" (
	"battle_id" uuid NOT NULL,
	"side" integer NOT NULL,
	"emperor_id" uuid NOT NULL,
	"outcome" text,
	CONSTRAINT "battle_sides_battle_id_side_pk" PRIMARY KEY("battle_id","side"),
	CONSTRAINT "battle_sides_side" CHECK ("battle_sides"."side" IN (0, 1)),
	CONSTRAINT "battle_sides_outcome" CHECK ("battle_sides"."outcome" IS NULL OR "battle_sides"."outcome" IN ('won', 'lost', 'fled', 'draw'))
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" text NOT NULL,
	"seed" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_round_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "battle_id" uuid;--> statement-breakpoint
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_sides" ADD CONSTRAINT "battle_sides_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_sides" ADD CONSTRAINT "battle_sides_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "battle_sides_emperor_id_idx" ON "battle_sides" USING btree ("emperor_id");--> statement-breakpoint
CREATE INDEX "battles_system_id_idx" ON "battles" USING btree ("system_id");--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleets_battle_id_idx" ON "fleets" USING btree ("battle_id");--> statement-breakpoint
CREATE INDEX "fleets_system_id_idx" ON "fleets" USING btree ("system_id");