ALTER TABLE "emperors" ADD COLUMN "fuel" double precision DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "fuel_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "cannon_ammo" integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "missiles" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "ammo_at" timestamp with time zone DEFAULT now() NOT NULL;