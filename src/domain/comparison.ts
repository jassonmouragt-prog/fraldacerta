import type { Offer, SearchFilters, SearchSort } from "./search";

export function priceToCents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function unitPriceCents(priceCents: number, unitCount: number): number {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !Number.isSafeInteger(unitCount) || unitCount <= 0) throw new RangeError("Preço ou quantidade inválida");
  return priceCents / unitCount;
}

export function deliveredPriceCents(priceCents: number, shippingCents: number | null): number | null {
  if (shippingCents === null) return null;
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !Number.isSafeInteger(shippingCents) || shippingCents < 0) throw new RangeError("Preço inválido");
  const total = priceCents + shippingCents;
  if (!Number.isSafeInteger(total)) throw new RangeError("Preço fora do intervalo seguro");
  return total;
}

export function deliveredUnitPriceCents(priceCents: number, shippingCents: number | null, unitCount: number): number | null {
  const delivered = deliveredPriceCents(priceCents, shippingCents);
  return delivered === null ? null : unitPriceCents(delivered, unitCount);
}

export function filterOffers(offers: Offer[], filters: SearchFilters): Offer[] {
  return offers.filter((offer) => offer.product.size === filters.size &&
    (!filters.brand || offer.product.brand.toLocaleLowerCase("pt-BR") === filters.brand.toLocaleLowerCase("pt-BR")) &&
    (filters.style === "all" || offer.product.style === filters.style));
}

export function deduplicateOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = [offer.source, offer.store.id, offer.product.brand, offer.product.name.toLocaleLowerCase("pt-BR"), offer.product.size, offer.product.style, offer.unitCount, offer.packagePriceCents].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortOffers(offers: Offer[], sort: SearchSort): Offer[] {
  return [...offers].sort((a, b) => {
    if (sort === "total-price") return a.packagePriceCents - b.packagePriceCents || a.unitPriceCents - b.unitPriceCents;
    if (sort === "delivered-price") return (deliveredPriceCents(a.packagePriceCents, a.shippingPriceCents) ?? Infinity) - (deliveredPriceCents(b.packagePriceCents, b.shippingPriceCents) ?? Infinity) || a.unitPriceCents - b.unitPriceCents;
    return a.unitPriceCents - b.unitPriceCents || a.packagePriceCents - b.packagePriceCents;
  });
}
