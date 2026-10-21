CREATE TABLE "emperor_wallets" (
	"emperor_id" uuid PRIMARY KEY NOT NULL,
	"credits" double precision NOT NULL,
	"income_per_hour" double precision DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "emperor_wallets_nonnegative" CHECK ("emperor_wallets"."credits" >= 0 AND "emperor_wallets"."income_per_hour" >= 0)
);
--> statement-breakpoint
CREATE TABLE "humanity_contributions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"emperor_id" uuid,
	"project_id" text NOT NULL,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"credits" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "humanity_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"fund_check_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "humanity_treasury" (
	"id" integer PRIMARY KEY NOT NULL,
	"credits" double precision DEFAULT 0 NOT NULL,
	"income_per_hour" double precision DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "humanity_treasury_single" CHECK ("humanity_treasury"."id" = 1),
	CONSTRAINT "humanity_treasury_nonnegative" CHECK ("humanity_treasury"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"emperor_id" uuid NOT NULL,
	"colony_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"side" text NOT NULL,
	"price" double precision NOT NULL,
	"quantity" integer NOT NULL,
	"remaining" integer NOT NULL,
	"escrow_credits" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_orders_side" CHECK ("market_orders"."side" IN ('buy', 'sell')),
	CONSTRAINT "market_orders_resource" CHECK ("market_orders"."resource" IN ('metal', 'volatiles', 'crystal', 'alloys')),
	CONSTRAINT "market_orders_amounts" CHECK ("market_orders"."price" > 0 AND "market_orders"."remaining" > 0 AND "market_orders"."remaining" <= "market_orders"."quantity" AND "market_orders"."escrow_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"price" double precision NOT NULL,
	"quantity" integer NOT NULL,
	"buyer_id" uuid,
	"seller_id" uuid,
	"buyer_colony_id" uuid,
	"seller_colony_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"emperor_id" uuid,
	"from_colony_id" uuid,
	"from_system_id" text NOT NULL,
	"to_colony_id" uuid,
	"to_system_id" text,
	"project_id" text,
	"trade_id" bigint,
	"metal" double precision DEFAULT 0 NOT NULL,
	"volatiles" double precision DEFAULT 0 NOT NULL,
	"crystal" double precision DEFAULT 0 NOT NULL,
	"alloys" double precision DEFAULT 0 NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipments_kind" CHECK ("shipments"."kind" IN ('trade', 'contribution'))
);
--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD COLUMN "credits" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "emperor_wallets" ADD CONSTRAINT "emperor_wallets_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "humanity_contributions" ADD CONSTRAINT "humanity_contributions_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "market_trades_buyer_id_emperors_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "market_trades_seller_id_emperors_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_emperor_id_emperors_id_fk" FOREIGN KEY ("emperor_id") REFERENCES "public"."emperors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "humanity_contributions_project_idx" ON "humanity_contributions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "humanity_contributions_emperor_idx" ON "humanity_contributions" USING btree ("emperor_id");--> statement-breakpoint
CREATE INDEX "market_orders_book_idx" ON "market_orders" USING btree ("resource","side","price");--> statement-breakpoint
CREATE INDEX "market_orders_emperor_idx" ON "market_orders" USING btree ("emperor_id");--> statement-breakpoint
CREATE INDEX "market_trades_history_idx" ON "market_trades" USING btree ("resource","created_at");--> statement-breakpoint
CREATE INDEX "market_trades_buyer_idx" ON "market_trades" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "market_trades_seller_idx" ON "market_trades" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "shipments_emperor_idx" ON "shipments" USING btree ("emperor_id");--> statement-breakpoint
INSERT INTO "humanity_treasury" ("id") VALUES (1) ON CONFLICT DO NOTHING;