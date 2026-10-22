CREATE TABLE "ship_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emperor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hull_id" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ship_designs" ADD CONSTRAINT "ship_designs_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ship_designs_emperor_id_idx" ON "ship_designs" USING btree ("emperor_id");