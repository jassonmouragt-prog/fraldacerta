import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const affiliatePrograms = pgTable("affiliate_programs", {
  marketplace: text("marketplace").primaryKey(),
  status: text("status").notNull().default("pending"),
  siteApproved: boolean("site_approved").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const affiliateOffers = pgTable("affiliate_offers", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  productId: text("product_id").notNull(),
  productKey: text("product_key").notNull(),
  marketplace: text("marketplace").notNull(),
  name: text("name").notNull(),
  storeName: text("store_name").notNull(),
  originalUrl: text("original_url").notNull(),
  monetizationStatus: text("monetization_status").notNull().default("unmonetized"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("affiliate_offers_marketplace_idx").on(table.marketplace)]);

export const affiliateLinks = pgTable("affiliate_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: text("offer_id").notNull().unique().references(() => affiliateOffers.id),
  productKey: text("product_key").notNull(),
  url: text("url").notNull(),
  mode: text("mode").notNull().default("manual"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("affiliate_links_status_idx").on(table.status)]);

export const affiliateClicks = pgTable("affiliate_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: text("offer_id").notNull().references(() => affiliateOffers.id),
  linkId: uuid("link_id").references(() => affiliateLinks.id),
  marketplace: text("marketplace").notNull(),
  origin: text("origin").notNull(),
  commissioned: boolean("commissioned").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("affiliate_clicks_offer_idx").on(table.offerId), index("affiliate_clicks_marketplace_idx").on(table.marketplace)]);
