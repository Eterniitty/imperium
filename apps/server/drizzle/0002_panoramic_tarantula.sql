ALTER TABLE "emperors" ADD COLUMN "dest_system_id" text;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "depart_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "arrive_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_travel_complete" CHECK (("emperors"."dest_system_id" IS NULL) = ("emperors"."depart_at" IS NULL) AND ("emperors"."depart_at" IS NULL) = ("emperors"."arrive_at" IS NULL));