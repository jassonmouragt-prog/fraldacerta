import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { affiliateDb } from "./db";
import { affiliateClicks, affiliateLinks, affiliateOffers, affiliatePrograms } from "./schema";
import { classifyOffer, validateAffiliateLink, type Marketplace } from "./marketplaces";
import { AffiliateManager, type AffiliateRepository, type StoredAffiliateLink, type StoredAffiliateOffer } from "./manager";

function requireDb() {
  const db = affiliateDb();
  if (!db) throw new Error("Banco Neon não configurado.");
  return db;
}

class DrizzleAffiliateRepository implements AffiliateRepository {
  async upsertOffer(offer: StoredAffiliateOffer) {
    await requireDb().insert(affiliateOffers).values(offer).onConflictDoUpdate({ target: affiliateOffers.id, set: { source: offer.source, productId: offer.productId, productKey: offer.productKey, marketplace: offer.marketplace, name: offer.name, storeName: offer.storeName, originalUrl: offer.originalUrl, lastSeenAt: new Date() } });
  }
  async getOffer(id: string) {
    const [row] = await requireDb().select().from(affiliateOffers).where(eq(affiliateOffers.id, id)).limit(1);
    return row ? { ...row, marketplace: row.marketplace as Marketplace } : null;
  }
  async getLink(offerId: string): Promise<StoredAffiliateLink | null> {
    const [row] = await requireDb().select().from(affiliateLinks).where(eq(affiliateLinks.offerId, offerId)).limit(1);
    return row ? { ...row, status: row.status as StoredAffiliateLink["status"] } : null;
  }
  async isProgramActive(marketplace: Marketplace) {
    const [row] = await requireDb().select().from(affiliatePrograms).where(eq(affiliatePrograms.marketplace, marketplace)).limit(1);
    return row?.status === "active" && row.siteApproved;
  }
  async addClick(click: { offerId: string; linkId: string | null; marketplace: Marketplace; origin: string; commissioned: boolean }) {
    await requireDb().insert(affiliateClicks).values(click);
  }
}

export function affiliateManager() { return affiliateDb() ? new AffiliateManager(new DrizzleAffiliateRepository()) : null; }

export async function saveManualLink(input: { offerId: string; url: string; expiresAt: Date | null }) {
  const db = requireDb();
  const [offer] = await db.select().from(affiliateOffers).where(eq(affiliateOffers.id, input.offerId)).limit(1);
  if (!offer) throw new Error("Oferta não encontrada. Faça uma busca antes de cadastrar o link.");
  const classified = classifyOffer(offer.originalUrl);
  if (!classified || classified.productKey !== offer.productKey || !validateAffiliateLink(offer.originalUrl, input.url) || (offer.marketplace === "amazon" && offer.source !== "amazon")) throw new Error("O link deve apontar para o mesmo produto e marketplace da oferta, com fonte de preço autorizada.");
  await db.insert(affiliateLinks).values({ offerId: offer.id, productKey: offer.productKey, url: input.url, mode: "manual", status: "pending", expiresAt: input.expiresAt }).onConflictDoUpdate({ target: affiliateLinks.offerId, set: { productKey: offer.productKey, url: input.url, status: "pending", expiresAt: input.expiresAt, updatedAt: new Date() } });
  await db.update(affiliateOffers).set({ monetizationStatus: "pending" }).where(eq(affiliateOffers.id, offer.id));
}

export async function setLinkStatus(offerId: string, status: "active" | "pending") {
  const db = requireDb();
  const [offer] = await db.select().from(affiliateOffers).where(eq(affiliateOffers.id, offerId)).limit(1);
  const [link] = await db.select().from(affiliateLinks).where(eq(affiliateLinks.offerId, offerId)).limit(1);
  if (!offer || !link) throw new Error("Link ausente.");
  if (status === "active" && (link.productKey !== offer.productKey || !validateAffiliateLink(offer.originalUrl, link.url) || (offer.marketplace === "amazon" && offer.source !== "amazon") || (link.expiresAt && link.expiresAt <= new Date()))) throw new Error("Link expirado ou incompatível com a oferta.");
  await db.update(affiliateLinks).set({ status, updatedAt: new Date() }).where(eq(affiliateLinks.offerId, offerId));
  await db.update(affiliateOffers).set({ monetizationStatus: status }).where(eq(affiliateOffers.id, offerId));
}

export async function setProgramStatus(marketplace: Marketplace, active: boolean) {
  await requireDb().insert(affiliatePrograms).values({ marketplace, status: active ? "active" : "pending", siteApproved: active }).onConflictDoUpdate({ target: affiliatePrograms.marketplace, set: { status: active ? "active" : "pending", siteApproved: active, updatedAt: new Date() } });
}

export async function affiliateDashboard() {
  const db = requireDb();
  const [total] = await db.select({ count: count() }).from(affiliateClicks);
  const byMarketplace = await db.select({ marketplace: affiliateClicks.marketplace, count: count() }).from(affiliateClicks).groupBy(affiliateClicks.marketplace);
  const topOffers = await db.select({ offerId: affiliateClicks.offerId, name: affiliateOffers.name, count: count() }).from(affiliateClicks).innerJoin(affiliateOffers, eq(affiliateClicks.offerId, affiliateOffers.id)).groupBy(affiliateClicks.offerId, affiliateOffers.name).orderBy(desc(count())).limit(10);
  const offers = await db.select({ id: affiliateOffers.id, name: affiliateOffers.name, marketplace: affiliateOffers.marketplace, productKey: affiliateOffers.productKey, originalUrl: affiliateOffers.originalUrl, linkStatus: affiliateLinks.status, linkUrl: affiliateLinks.url, expiresAt: affiliateLinks.expiresAt }).from(affiliateOffers).leftJoin(affiliateLinks, eq(affiliateOffers.id, affiliateLinks.offerId)).orderBy(desc(affiliateOffers.lastSeenAt)).limit(50);
  const programs = await db.select().from(affiliatePrograms);
  const [active] = await db.select({ count: count() }).from(affiliateLinks).innerJoin(affiliateOffers, eq(affiliateLinks.offerId, affiliateOffers.id)).innerJoin(affiliatePrograms, eq(affiliatePrograms.marketplace, affiliateOffers.marketplace)).where(and(eq(affiliateLinks.status, "active"), eq(affiliatePrograms.status, "active"), eq(affiliatePrograms.siteApproved, true), or(isNull(affiliateLinks.expiresAt), gt(affiliateLinks.expiresAt, new Date()))));
  const [pending] = await db.select({ count: count() }).from(affiliateLinks).where(eq(affiliateLinks.status, "pending"));
  return { totalClicks: total.count, byMarketplace, topOffers, offers, programs, activeLinks: active.count, pendingLinks: pending.count };
}
