import { createHash } from "node:crypto";
import { normalizeListing, validateOfferUrl } from "@/domain/normalization";
import type { SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "./marketplace";
import { rankEligibleProducts, ProductOffersResolver } from "./product-offers-resolver";

interface ShoppingItem {
  title?: unknown;
  seller?: unknown;
  domain?: unknown;
  link?: unknown;
  product_link?: unknown;
  extracted_price?: unknown;
  image?: unknown;
  thumbnail?: unknown;
  product_token?: unknown;
}

interface SearchPayload {
  error?: unknown;
  search_metadata?: { created_at?: unknown };
  shopping_ads?: unknown;
  shopping_results?: unknown;
}

const CACHE_MS = 5 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 18_000;

function merchantUrl(item: ShoppingItem): string | null {
  const value = typeof item.link === "string" ? item.link : null;
  const domain = typeof item.domain === "string" ? item.domain.toLowerCase() : null;
  if (!value || !domain || !/^[a-z0-9.-]+$/.test(domain) || domain === "localhost" || domain.endsWith(".localhost")) return null;
  try {
    const host = new URL(value).hostname;
    if (host === "google.com" || host.endsWith(".google.com") || host === "google.com.br" || host.endsWith(".google.com.br") || host === "searchapi.io" || host.endsWith(".searchapi.io")) return null;
  } catch { return null; }
  return validateOfferUrl(value, [domain]) ? value : null;
}

export class SearchApiAdapter implements MarketplaceConnector {
  readonly id = "google-shopping";
  readonly name = "SearchAPI.io Google Shopping";
  private readonly cache = new Map<string, { payload: SearchPayload; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<SearchPayload>>();
  private requests: number[] = [];
  private readonly resolver: ProductOffersResolver;

  constructor(private readonly options: { apiKey?: string; fetcher?: typeof fetch; now?: () => number; maxRequestsPerDay?: number; maxProductResolutionsPerSearch?: number; maxOfferRequestsPerDay?: number } = {}) {
    this.resolver = new ProductOffersResolver({ fetcher: options.fetcher, now: options.now, maxRequestsPerDay: options.maxOfferRequestsPerDay });
  }

  private get now() { return this.options.now ?? Date.now; }

  private async getPayload(query: string, apiKey: string): Promise<SearchPayload> {
    const cacheKey = `${apiKey}\0${query}`;
    for (const [key, value] of this.cache) if (value.expiresAt <= this.now()) this.cache.delete(key);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.payload;
    const active = this.pending.get(cacheKey);
    if (active) return active;
    this.requests = this.requests.filter((time) => time > this.now() - WINDOW_MS);
    if (this.requests.length >= (this.options.maxRequestsPerDay ?? 20)) throw new MarketplaceUnavailableError("Limite diário local de consultas ao SearchAPI.io atingido.");
    this.requests.push(this.now());

    const request = (async () => {
      const url = new URL("https://www.searchapi.io/api/v1/search");
      for (const [name, value] of Object.entries({ engine: "google_shopping", q: query, gl: "br", hl: "pt-br", link: "raw" })) url.searchParams.set(name, value);
      let response: Response;
      try {
        response = await (this.options.fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      } catch (error) {
        throw new MarketplaceUnavailableError(error instanceof Error && error.name === "TimeoutError" ? "Tempo limite na consulta ao SearchAPI.io." : "Falha de rede na consulta ao SearchAPI.io.");
      }
      if (response.status === 401) throw new MarketplaceUnavailableError("Credencial do SearchAPI.io inválida.");
      if (response.status === 403) throw new MarketplaceUnavailableError("Acesso ao SearchAPI.io não autorizado.");
      if (response.status === 429) throw new MarketplaceUnavailableError("Limite de consultas do SearchAPI.io atingido.");
      if (!response.ok) throw new MarketplaceUnavailableError("Falha na API externa de preços.");
      let payload: SearchPayload;
      try { payload = await response.json() as SearchPayload; }
      catch { throw new MarketplaceUnavailableError("Resposta inválida do SearchAPI.io."); }
      if (!payload || typeof payload !== "object" || payload.error) throw new MarketplaceUnavailableError("Falha na API externa de preços.");
      if ((payload.shopping_ads !== undefined && !Array.isArray(payload.shopping_ads)) || (payload.shopping_results !== undefined && !Array.isArray(payload.shopping_results))) throw new MarketplaceUnavailableError("Resposta inválida do SearchAPI.io.");
      this.cache.set(cacheKey, { payload, expiresAt: this.now() + CACHE_MS });
      return payload;
    })();
    this.pending.set(cacheKey, request);
    try { return await request; }
    finally { this.pending.delete(cacheKey); }
  }

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    return this.searchWithControl(filters, {}, signal);
  }

  async searchWithControl(filters: SearchFilters, control: { limit?: number; skipTokens?: readonly string[] } = {}, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    const apiKey = (this.options.apiKey ?? process.env.SEARCHAPI_API_KEY)?.trim();
    if (!apiKey?.trim()) throw new MarketplaceUnavailableError("Credencial do SearchAPI.io não configurada.");
    if (signal?.aborted) throw new MarketplaceUnavailableError("Consulta ao SearchAPI.io cancelada.");
    const query = ["fralda", filters.brand, filters.size].filter(Boolean).join(" ");
    const payload = await this.getPayload(query, apiKey);
    const ads = (payload.shopping_ads ?? []) as ShoppingItem[];
    const results = (payload.shopping_results ?? []) as ShoppingItem[];
    const rejected: Record<string, number> = {};
    const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
    const checkedAt = typeof payload.search_metadata?.created_at === "string" && Number.isFinite(Date.parse(payload.search_metadata.created_at)) ? payload.search_metadata.created_at : new Date(this.now()).toISOString();
    const offers = [];
    for (const [kind, item] of [...ads.map((value) => ["ad", value] as const), ...results.map((value) => ["result", value] as const)]) {
      if (!item || typeof item !== "object" || typeof item.title !== "string" || typeof item.seller !== "string") { reject("invalid-listing"); continue; }
      const url = merchantUrl(item);
      if (!url) { reject(kind === "result" && typeof item.product_link === "string" ? "aggregate-product" : "invalid-url"); continue; }
      const normalized = normalizeListing({
        source: this.id, id: createHash("sha256").update(url).digest("hex").slice(0, 20), title: item.title,
        price: typeof item.extracted_price === "number" ? item.extracted_price : NaN,
        url, storeName: item.seller, checkedAt,
        imageUrl: typeof (item.image ?? item.thumbnail) === "string" && String(item.image ?? item.thumbnail).startsWith("https://") ? String(item.image ?? item.thumbnail) : null,
        shippingPrice: null, allowedHosts: [item.domain as string]
      });
      if (!normalized.ok) { reject(normalized.reason); continue; }
      if (normalized.offer.product.size !== filters.size || (filters.brand && normalized.offer.product.brand !== filters.brand) || (filters.style !== "all" && normalized.offer.product.style !== filters.style)) { reject("filter-mismatch"); continue; }
      offers.push(normalized.offer);
    }
    const eligible = rankEligibleProducts(results, filters);
    const skipped = new Set(control.skipTokens ?? []);
    const remaining = eligible.filter((item) => !skipped.has(item.product_token as string));
    const limit = Math.max(0, Math.min(2, control.limit ?? this.options.maxProductResolutionsPerSearch ?? 1));
    let resolution: ConnectorSearchResult["resolution"] = { status: "pending", reason: eligible.length ? "Resolução de vendedores pendente." : "Nenhum produto com token e atributos suficientes.", sellerCount: 0 };
    const attemptedTokens: string[] = [];
    for (const product of remaining.slice(0, limit)) {
      attemptedTokens.push(product.product_token as string);
      const found = await this.resolver.resolve(product, filters, apiKey, signal);
      offers.push(...found.offers);
      for (const [reason, count] of Object.entries(found.rejected)) rejected[reason] = (rejected[reason] ?? 0) + count;
      resolution = { status: found.status, reason: found.reason, sellerCount: found.receivedCount };
      if (found.status === "unavailable") break;
    }
    return { offers, rejected, receivedCount: ads.length + results.length, resolution, attemptedTokens, progress: { cursor: "", hasMore: remaining.length > attemptedTokens.length, cached: false } };
  }
}
