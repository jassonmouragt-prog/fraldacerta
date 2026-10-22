import type { Offer } from "../domain/search";
import { chooseDestination, classifyOffer, type Marketplace } from "./marketplaces";

export type StoredAffiliateOffer = {
  id: string; source: string; productId: string; productKey: string; marketplace: Marketplace;
  name: string; storeName: string; originalUrl: string;
};
export type StoredAffiliateLink = {
  id: string; offerId: string; productKey: string; url: string;
  status: "pending" | "active" | "expired"; expiresAt: Date | null;
};
export interface AffiliateRepository {
  upsertOffer(offer: StoredAffiliateOffer): Promise<void>;
  getOffer(id: string): Promise<StoredAffiliateOffer | null>;
  getLink(offerId: string): Promise<StoredAffiliateLink | null>;
  isProgramActive(marketplace: Marketplace): Promise<boolean>;
  addClick(click: { offerId: string; linkId: string | null; marketplace: Marketplace; origin: string; commissioned: boolean }): Promise<void>;
}

export class AffiliateManager {
  constructor(private readonly repository: AffiliateRepository) {}

  async prepareOffers(offers: Offer[]): Promise<Offer[]> {
    await Promise.all(offers.map(async (offer) => {
      const classified = classifyOffer(offer.url);
      if (!classified) return;
      await this.repository.upsertOffer({ id: offer.id, source: offer.source, productId: offer.product.id, productKey: classified.productKey, marketplace: classified.marketplace, name: offer.product.name, storeName: offer.store.name, originalUrl: offer.url });
    }));
    return Promise.all(offers.map(async (offer) => {
      const resolved = await this.resolve(offer.id);
      return resolved ? { ...offer, outbound: { href: `/sair/${encodeURIComponent(offer.id)}?origem=resultados`, commissioned: resolved.commissioned, marketplace: resolved.offer.marketplace } } : offer;
    }));
  }

  async resolve(offerId: string) {
    const offer = await this.repository.getOffer(offerId);
    if (!offer) return null;
    const classified = classifyOffer(offer.originalUrl);
    if (!classified || classified.marketplace !== offer.marketplace || classified.productKey !== offer.productKey) return null;
    const [link, programActive] = await Promise.all([this.repository.getLink(offerId), this.repository.isProgramActive(offer.marketplace)]);
    const matchingLink = link?.offerId === offer.id && link.productKey === offer.productKey ? link : null;
    // Amazon comparison prices must come from its authorized API, not SearchAPI listings.
    const eligibleSource = offer.marketplace !== "amazon" || offer.source === "amazon";
    const destination = chooseDestination(offer.originalUrl, matchingLink, programActive && eligibleSource);
    return { offer, ...destination, linkId: destination.commissioned ? matchingLink?.id ?? null : null };
  }

  async trackClick(offerId: string, origin: string) {
    const resolved = await this.resolve(offerId);
    if (!resolved) return false;
    await this.repository.addClick({ offerId, linkId: resolved.linkId, marketplace: resolved.offer.marketplace, origin, commissioned: resolved.commissioned });
    return true;
  }
}
