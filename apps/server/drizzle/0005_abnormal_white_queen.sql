CREATE TABLE "discoveries" (
	"emperor_id" uuid NOT NULL,
	"system_id" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discoveries_emperor_id_system_id_pk" PRIMARY KEY("emperor_id","system_id")
);
--> statement-breakpoint
ALTER TABLE "discoveries" ADD CONSTRAINT "discoveries_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;