CREATE TABLE "affiliate_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" text NOT NULL,
	"link_id" uuid,
	"marketplace" text NOT NULL,
	"origin" text NOT NULL,
	"commissioned" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" text NOT NULL,
	"product_key" text NOT NULL,
	"url" text NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_links_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "affiliate_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"product_id" text NOT NULL,
	"product_key" text NOT NULL,
	"marketplace" text NOT NULL,
	"name" text NOT NULL,
	"store_name" text NOT NULL,
	"original_url" text NOT NULL,
	"monetization_status" text DEFAULT 'unmonetized' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_programs" (
	"marketplace" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"site_approved" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_offer_id_affiliate_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."affiliate_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_link_id_affiliate_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_offer_id_affiliate_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."affiliate_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_clicks_offer_idx" ON "affiliate_clicks" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "affiliate_clicks_marketplace_idx" ON "affiliate_clicks" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "affiliate_links_status_idx" ON "affiliate_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "affiliate_offers_marketplace_idx" ON "affiliate_offers" USING btree ("marketplace");
--> statement-breakpoint
INSERT INTO "affiliate_programs" ("marketplace", "status", "site_approved") VALUES ('shopee', 'pending', false), ('amazon', 'pending', false), ('mercado-livre', 'pending', false);
