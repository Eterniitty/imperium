ALTER TABLE "colonies" DROP CONSTRAINT "colonies_emperor_id_emperors_id_fk";
--> statement-breakpoint
ALTER TABLE "colonies" ALTER COLUMN "emperor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "colonies" ADD CONSTRAINT "colonies_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;