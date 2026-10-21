ALTER TABLE "emperors" ADD COLUMN "park_x" double precision;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "park_y" double precision;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "park_z" double precision;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "park_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emperors" ADD CONSTRAINT "emperors_park_complete" CHECK (("emperors"."park_x" IS NULL) = ("emperors"."park_at" IS NULL) AND ("emperors"."park_y" IS NULL) = ("emperors"."park_at" IS NULL) AND ("emperors"."park_z" IS NULL) = ("emperors"."park_at" IS NULL));