CREATE TABLE "emperor_allies" (
	"emperor_id" uuid NOT NULL,
	"ally_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emperor_allies_emperor_id_ally_id_pk" PRIMARY KEY("emperor_id","ally_id"),
	CONSTRAINT "emperor_allies_not_self" CHECK ("emperor_allies"."emperor_id" <> "emperor_allies"."ally_id")
);
--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "visibility" text DEFAULT 'allies' NOT NULL;--> statement-breakpoint
ALTER TABLE "emperor_allies" ADD CONSTRAINT "emperor_allies_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emperor_allies" ADD CONSTRAINT "emperor_allies_ally_id_emperors_id_fk" FOREIGN KEY ("ally_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emperor_allies_ally_id_idx" ON "emperor_allies" USING btree ("ally_id");--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_visibility" CHECK ("emperors"."visibility" IN ('public', 'allies', 'hidden'));