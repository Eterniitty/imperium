CREATE TABLE "asteroid_depletion" (
	"region_id" text NOT NULL,
	"asteroid" integer NOT NULL,
	"mined" double precision NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "asteroid_depletion_region_id_asteroid_pk" PRIMARY KEY("region_id","asteroid"),
	CONSTRAINT "asteroid_depletion_mined" CHECK ("asteroid_depletion"."mined" >= 0)
);
--> statement-breakpoint
ALTER TABLE "colonies" DROP CONSTRAINT "colonies_stock_nonnegative";--> statement-breakpoint
ALTER TABLE "market_orders" DROP CONSTRAINT "market_orders_resource";--> statement-breakpoint
ALTER TABLE "colonies" ADD COLUMN "rare_metals" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "colonies" ADD COLUMN "exotic" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperors" ADD COLUMN "hold" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "humanity_contributions" ADD COLUMN "rare_metals" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "humanity_contributions" ADD COLUMN "exotic" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "humanity_projects" ADD COLUMN "rare_metals" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "humanity_projects" ADD COLUMN "exotic" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD COLUMN "rare_metals" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD COLUMN "exotic" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "rare_metals" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "exotic" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "colonies" ADD CONSTRAINT "colonies_stock_nonnegative" CHECK ("colonies"."population" >= 0 AND "colonies"."metal" >= 0 AND "colonies"."volatiles" >= 0 AND "colonies"."crystal" >= 0 AND "colonies"."alloys" >= 0 AND "colonies"."rare_metals" >= 0 AND "colonies"."exotic" >= 0);--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_resource" CHECK ("market_orders"."resource" IN ('metal', 'volatiles', 'crystal', 'alloys', 'rare_metals', 'exotic'));