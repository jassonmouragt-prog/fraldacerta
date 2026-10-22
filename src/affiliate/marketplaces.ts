export type Marketplace = "shopee" | "amazon" | "mercado-livre";
export type MarketplaceProduct = { marketplace: Marketplace; productKey: string };

const hosts: Record<Marketplace, readonly string[]> = {
  shopee: ["shopee.com.br"],
  amazon: ["amazon.com.br"],
  "mercado-livre": ["mercadolivre.com.br", "mercadolibre.com.br"]
};

export function safeMarketplaceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !/^[a-z0-9.-]+$/.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export function classifyOffer(value: string): MarketplaceProduct | null {
  const url = safeMarketplaceUrl(value);
  if (!url) return null;
  const marketplace = (Object.keys(hosts) as Marketplace[]).find((name) => hosts[name].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
  if (!marketplace) return null;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return null; }
  if (marketplace === "amazon") {
    const asin = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
    return asin ? { marketplace, productKey: asin.toUpperCase() } : null;
  }
  if (marketplace === "mercado-livre") {
    const id = path.match(/\bMLB[-_]?\d{6,}\b/i)?.[0];
    return id ? { marketplace, productKey: id.replace(/[-_]/g, "").toUpperCase() } : null;
  }
  const product = path.match(/\/product\/(\d+)\/(\d+)(?:\/|$)/i) ?? path.match(/-i\.(\d+)\.(\d+)(?:\/|$)/i);
  return product ? { marketplace, productKey: `${product[1]}:${product[2]}` } : null;
}

export function validateAffiliateLink(originalUrl: string, affiliateUrl: string): boolean {
  const original = classifyOffer(originalUrl);
  const candidate = classifyOffer(affiliateUrl);
  if (!original || !candidate || original.marketplace !== candidate.marketplace || original.productKey !== candidate.productKey || originalUrl === affiliateUrl) return false;
  if (original.marketplace === "amazon" && !safeMarketplaceUrl(affiliateUrl)?.searchParams.get("tag")) return false;
  return true;
}

export type AffiliateCandidate = { url: string; status: "pending" | "active" | "expired"; expiresAt: Date | null };

export function chooseDestination(originalUrl: string, link: AffiliateCandidate | null, programApproved: boolean, now = new Date()): { url: string; commissioned: boolean } {
  if (programApproved && link?.status === "active" && (!link.expiresAt || link.expiresAt > now) && validateAffiliateLink(originalUrl, link.url)) return { url: link.url, commissioned: true };
  return { url: originalUrl, commissioned: false };
}
