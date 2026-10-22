CREATE TABLE "legends" (
	"id" text PRIMARY KEY NOT NULL,
	"emperor_id" uuid NOT NULL,
	"emperor_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legends" ADD CONSTRAINT "legends_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;