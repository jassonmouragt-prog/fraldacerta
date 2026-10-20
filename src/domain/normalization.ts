import { priceToCents, unitPriceCents } from "./comparison";
import type { DiaperSize, Offer } from "./search";

export interface RawListing {
  source: string;
  id: string;
  title: string;
  price: number;
  url: string;
  storeName: string;
  checkedAt: string;
  imageUrl: string | null;
  shippingPrice?: number | null;
  allowedHosts?: readonly string[];
  origin?: "live" | "imported";
  availabilityConfirmed?: boolean;
}

export type RejectionReason = "invalid-url" | "invalid-price" | "invalid-listing" | "unknown-brand" | "ambiguous-brand" | "missing-size" | "ambiguous-size" | "unsupported-size" | "unknown-style" | "missing-quantity" | "ambiguous-quantity";
export type NormalizationResult = { ok: true; offer: Offer } | { ok: false; reason: RejectionReason };

const brandPatterns = [
  ["Pampers", /\bpampers\b/], ["Huggies", /\bhuggies\b/], ["MamyPoko", /\bmamy\s*poko\b/],
  ["Babysec", /\bbabysec\b/], ["Personal", /\bpersonal\b/], ["Cremer", /\bcremer\b/], ["Pom Pom", /\bpom\s*pom\b/]
] as const;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function validateOfferUrl(value: string, allowedHosts: readonly string[] = ["mercadolivre.com.br", "mercadolibre.com.br"]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function parseQuantity(title: string): { unitCount: number; packageCount: number; unitsPerPackage: number } | null {
  const kit = title.match(/\bkit\s*(?:com\s*)?(\d{1,2})\s*(?:pacotes?|pct?s?)\b/) ?? title.match(/\b(\d{1,2})\s*(?:pacotes?|pct?s?)\b/);
  const packageCount = kit ? Number(kit[1]) : 1;
  if (packageCount < 1 || packageCount > 30) return null;
  const quantities = [...title.matchAll(/\b(\d{1,4})\s*(?:unidades?|unds?|un\b|fraldas?)\b/g)].map((match) => ({ value: Number(match[1]), index: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
  const multiplication = title.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,4})\s*(?:unidades?|unds?|un\b)?/);
  if (multiplication && !kit && quantities.length === 0) {
    const count = Number(multiplication[1]), per = Number(multiplication[2]);
    return count > 0 && per > 0 ? { unitCount: count * per, packageCount: count, unitsPerPackage: per } : null;
  }
  if (quantities.length === 0 || quantities.some((item) => item.value < 1)) return null;
  if (packageCount === 1) return quantities.length === 1 ? { unitCount: quantities[0].value, packageCount: 1, unitsPerPackage: quantities[0].value } : null;
  const each = quantities.filter((item) => /\b(cada|por\s+pacote)\b/.test(title.slice(item.end, item.end + 22)));
  const total = quantities.filter((item) => /\b(total|ao\s+todo|no\s+kit)\b/.test(title.slice(item.end, item.end + 23)));
  if (each.length > 1 || total.length > 1) return null;
  if (each.length === 1) {
    const unitsPerPackage = each[0].value;
    const unitCount = packageCount * unitsPerPackage;
    if (quantities.some((item) => item !== each[0] && item.value !== unitCount)) return null;
    return { unitCount, packageCount, unitsPerPackage };
  }
  if (total.length === 1 && quantities.length === 1 && total[0].value % packageCount === 0) return { unitCount: total[0].value, packageCount, unitsPerPackage: total[0].value / packageCount };
  return null;
}

export function normalizeListing(raw: RawListing): NormalizationResult {
  if (!raw.id || !raw.source || !raw.title || !raw.storeName || !Number.isFinite(Date.parse(raw.checkedAt))) return { ok: false, reason: "invalid-listing" };
  if (!validateOfferUrl(raw.url, raw.allowedHosts)) return { ok: false, reason: "invalid-url" };
  const packagePriceCents = priceToCents(raw.price);
  const shippingPriceCents = raw.shippingPrice === undefined || raw.shippingPrice === null ? null : priceToCents(raw.shippingPrice);
  if (packagePriceCents === null || packagePriceCents === 0 || (raw.shippingPrice != null && shippingPriceCents === null)) return { ok: false, reason: "invalid-price" };
  const title = fold(raw.title);
  const brands = brandPatterns.filter(([, pattern]) => pattern.test(title));
  if (brands.length === 0) return { ok: false, reason: "unknown-brand" };
  if (brands.length > 1) return { ok: false, reason: "ambiguous-brand" };
  const sizes = [...title.matchAll(/\b(rn|xxg|xg|gg|g|m|p)\b/g)].map((match) => match[1].toUpperCase());
  const uniqueSizes = [...new Set(sizes)];
  if (uniqueSizes.length === 0) return { ok: false, reason: "missing-size" };
  if (uniqueSizes.length > 1) return { ok: false, reason: "ambiguous-size" };
  if (uniqueSizes[0] === "GG") return { ok: false, reason: "unsupported-size" };
  const size = uniqueSizes[0] as DiaperSize;
  const pants = /\b(calca|pants?|roupinha|shortinho)\b/.test(title);
  const tape = /\b(fita|adesiva|confort\s+sec|supreme\s+care)\b/.test(title);
  if (!pants && !tape) return { ok: false, reason: "unknown-style" };
  const quantity = parseQuantity(title);
  if (!quantity) return { ok: false, reason: /\b\d+\s*(?:unidades?|unds?|un\b|fraldas?)\b/.test(title) ? "ambiguous-quantity" : "missing-quantity" };
  const brand = brands[0][0];
  const line = raw.title
    .replace(/\bkit\s*(?:com\s*)?\d+\s*(?:pacotes?|pct?s?)\b/gi, "")
    .replace(/\b\d+\s*(?:unidades?|unds?|un\b|fraldas?)\b/gi, "")
    .replace(/\b(no\s+total|ao\s+todo|total|cada|por\s+pacote|fraldas?|calça|calca|pants?|roupinha|shortinho|fita|adesiva|tamanho)\b/gi, "")
    .replace(new RegExp(`\\b${brand.replace(" ", "\\s*")}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${size}\\b`, "gi"), "")
    .replace(/\s+/g, " ").trim() || null;
  const offer: Offer = {
    id: `${raw.source}:${raw.id}`, source: raw.source,
    product: { id: raw.id, brand, line, name: raw.title, size, style: pants ? "pants" : "tape", imageUrl: raw.imageUrl },
    store: { id: `${raw.source}:${raw.storeName.toLowerCase()}`, name: raw.storeName },
    ...quantity, packagePriceCents, unitPriceCents: unitPriceCents(packagePriceCents, quantity.unitCount), shippingPriceCents,
    checkedAt: raw.checkedAt, url: raw.url, origin: raw.origin ?? "live", availabilityConfirmed: raw.availabilityConfirmed
  };
  return { ok: true, offer };
}
