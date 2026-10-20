import { normalizeListing, validateOfferUrl } from "@/domain/normalization";
import type { SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "./marketplace";

const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const MARKETPLACE = "www.amazon.com.br";

interface AmazonItem {
  asin?: unknown;
  detailPageURL?: unknown;
  itemInfo?: { title?: { displayValue?: unknown } };
  images?: { primary?: { medium?: { url?: unknown } } };
  offersV2?: { listings?: unknown };
}

export class AmazonAdapter implements MarketplaceConnector {
  readonly id = "amazon";
  readonly name = "Amazon Brasil";
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private nextSearchAt = 0;
  private searchDay = "";
  private dailySearches = 0;
  private searchQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: {
    clientId?: string;
    clientSecret?: string;
    partnerTag?: string;
    fetcher?: typeof fetch;
    now?: () => number;
  } = {}) {}

  private get fetcher() { return this.options.fetcher ?? fetch; }
  private get now() { return this.options.now ?? Date.now; }
  private get credentials() {
    return {
      clientId: this.options.clientId ?? process.env.AMAZON_CREATORS_CLIENT_ID,
      clientSecret: this.options.clientSecret ?? process.env.AMAZON_CREATORS_CLIENT_SECRET,
      partnerTag: this.options.partnerTag ?? process.env.AMAZON_PARTNER_TAG
    };
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) throw new MarketplaceUnavailableError("Credenciais Creators API não configuradas.");
    this.tokenPromise = (async () => {
      const response = await this.fetcher(TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
        body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "creatorsapi::default" })
      });
      if ([400, 401, 403, 429].includes(response.status)) throw new MarketplaceUnavailableError(`Autenticação Amazon indisponível (${response.status}).`);
      if (!response.ok) throw new Error(`Falha na autenticação Amazon (${response.status}).`);
      const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof payload.access_token !== "string" || !payload.access_token || typeof payload.expires_in !== "number" || payload.expires_in <= 0) throw new Error("Resposta de autenticação Amazon inválida.");
      this.token = { value: payload.access_token, expiresAt: this.now() + payload.expires_in * 1000 };
      return payload.access_token;
    })();
    try { return await this.tokenPromise; } finally { this.tokenPromise = null; }
  }

  private async throttle(signal?: AbortSignal): Promise<void> {
    const task = this.searchQueue.then(async () => {
      const day = new Date(this.now()).toISOString().slice(0, 10);
      if (day !== this.searchDay) { this.searchDay = day; this.dailySearches = 0; }
      if (this.dailySearches >= 8_000) throw new MarketplaceUnavailableError("Limite diário de consultas Amazon atingido.");
      const delay = Math.max(0, this.nextSearchAt - this.now());
      if (delay) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      this.nextSearchAt = this.now() + 1_000;
      this.dailySearches++;
    });
    this.searchQueue = task.catch(() => undefined);
    await task;
  }

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    const { clientId, clientSecret, partnerTag } = this.credentials;
    if (!clientId || !clientSecret || !partnerTag) throw new MarketplaceUnavailableError("Client ID, Client Secret ou Partner Tag da Amazon não configurados.");
    await this.throttle(signal);
    const token = await this.accessToken(signal);
    const response = await this.fetcher(SEARCH_URL, {
      method: "POST", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
      body: JSON.stringify({ marketplace: MARKETPLACE, partnerTag, keywords: `fralda ${filters.size}`, ...(filters.brand ? { brand: filters.brand } : {}), itemCount: 10, condition: "Any", availability: "Available", resources: ["images.primary.medium", "itemInfo.title", "offersV2.listings.price", "offersV2.listings.condition", "offersV2.listings.availability", "offersV2.listings.merchantInfo", "offersV2.listings.dealDetails"] })
    });
    if ([401, 403, 429].includes(response.status)) {
      if (response.status === 401) this.token = null;
      throw new MarketplaceUnavailableError(`Consulta Amazon indisponível (${response.status}).`);
    }
    if (!response.ok) throw new Error(`Amazon respondeu ${response.status}.`);
    const payload = await response.json() as { searchResult?: { items?: unknown }; errors?: unknown };
    if (!Array.isArray(payload.searchResult?.items)) throw new Error("Resposta de busca Amazon inválida.");
    const rejected: Record<string, number> = {};
    const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
    const offers = [];
    for (const item of (payload.searchResult.items as AmazonItem[]).slice(0, 10)) {
      if (typeof item.asin !== "string" || !/^[A-Z0-9]{10}$/.test(item.asin) || typeof item.detailPageURL !== "string" || !validateOfferUrl(item.detailPageURL, ["amazon.com.br"]) || new URL(item.detailPageURL).searchParams.get("tag") !== partnerTag) { reject("invalid-listing"); continue; }
      const title = item.itemInfo?.title?.displayValue;
      if (typeof title !== "string") { reject("invalid-listing"); continue; }
      const listings = Array.isArray(item.offersV2?.listings) ? item.offersV2.listings : [];
      const prices = listings.flatMap((listing: unknown) => {
        if (typeof listing !== "object" || !listing) return [];
        const value = listing as { condition?: { value?: unknown }; availability?: { type?: unknown }; price?: { money?: { amount?: unknown; currency?: unknown } }; merchantInfo?: { name?: unknown }; dealDetails?: { accessType?: unknown } };
        const amount = value.price?.money?.amount;
        return (value.condition?.value === "New" || value.condition?.value === "Used") && value.availability?.type === "IN_STOCK" && value.price?.money?.currency === "BRL" && typeof amount === "number" && Number.isFinite(amount) && amount > 0 && value.dealDetails?.accessType !== "PRIME_EXCLUSIVE" ? [{ amount, condition: value.condition.value, seller: typeof value.merchantInfo?.name === "string" ? value.merchantInfo.name : "Amazon Brasil" }] : [];
      });
      const lowest = prices.filter((price) => price.condition === "New").sort((a, b) => a.amount - b.amount)[0];
      if (!lowest) { reject("price-unavailable"); continue; }
      const image = item.images?.primary?.medium?.url;
      const imageUrl = typeof image === "string" && /^https:\/\/m\.media-amazon\.com\//.test(image) ? image : null;
      const normalized = normalizeListing({ source: this.id, id: item.asin, title, price: lowest.amount, url: item.detailPageURL, storeName: `Amazon Brasil · ${lowest.seller}`, checkedAt: new Date(this.now()).toISOString(), imageUrl, shippingPrice: null, allowedHosts: ["amazon.com.br"], origin: "live", availabilityConfirmed: true });
      if (!normalized.ok) { reject(normalized.reason); continue; }
      const used = prices.filter((price) => price.condition === "Used").sort((a, b) => a.amount - b.amount)[0];
      offers.push({ ...normalized.offer, ...(used ? { usedPriceCents: Math.round(used.amount * 100) } : {}) });
    }
    return { offers, rejected };
  }
}
