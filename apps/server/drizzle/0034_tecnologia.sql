ALTER TABLE "emperors" ADD COLUMN "tech" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "research" jsonb;