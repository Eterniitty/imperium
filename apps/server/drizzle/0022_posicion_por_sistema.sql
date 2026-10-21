CREATE TABLE "system_parks" (
	"emperor_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"z" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_parks_emperor_id_system_id_pk" PRIMARY KEY("emperor_id","system_id")
);
--> statement-breakpoint
ALTER TABLE "system_parks" ADD CONSTRAINT "system_parks_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;