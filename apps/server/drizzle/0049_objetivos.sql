CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"period" text NOT NULL,
	"idx" integer NOT NULL,
	"kind" text NOT NULL,
	"target" integer NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "goals_emperor_period_idx_unique" UNIQUE("emperor_id","period","idx")
);
--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "goal_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "goal_streak_day" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_emperor_id_idx" ON "goals" USING btree ("emperor_id");