import { normalizeListing } from "@/domain/normalization";
import type { SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "./marketplace";

interface ShoppingItem {
  product_id?: unknown;
  title?: unknown;
  extracted_price?: unknown;
  source?: unknown;
  product_link?: unknown;
  link?: unknown;
  thumbnail?: unknown;
}

export class GoogleShoppingAdapter implements MarketplaceConnector {
  readonly id = "google-shopping";
  readonly name = "Google Shopping";

  constructor(private readonly options: { apiKey?: string; fetcher?: typeof fetch } = {}) {}

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    const apiKey = this.options.apiKey ?? process.env.SERPAPI_API_KEY;
    if (!apiKey?.trim()) throw new MarketplaceUnavailableError("Credencial da SerpApi não configurada.");

    const url = new URL("https://serpapi.com/search.json");
    for (const [name, value] of Object.entries({ engine: "google_shopping", q: ["fralda", filters.brand, filters.size].filter(Boolean).join(" "), gl: "br", hl: "pt-br", api_key: apiKey })) url.searchParams.set(name, value);
    const response = await (this.options.fetcher ?? fetch)(url, { cache: "no-store", signal });
    if (response.status === 401 || response.status === 403) throw new MarketplaceUnavailableError("Credencial da SerpApi inválida ou sem acesso.");
    if (response.status === 429) throw new MarketplaceUnavailableError("Limite de consultas da SerpApi atingido.");
    if (!response.ok) throw new MarketplaceUnavailableError("Falha na API externa de preços.");

    const payload = await response.json() as { error?: unknown; shopping_results?: unknown };
    if (typeof payload.error === "string") {
      if (/limit|quota|searches|rate/i.test(payload.error)) throw new MarketplaceUnavailableError("Limite de consultas da SerpApi atingido.");
      if (/api key|unauthorized|forbidden/i.test(payload.error)) throw new MarketplaceUnavailableError("Credencial da SerpApi inválida ou sem acesso.");
      throw new MarketplaceUnavailableError("Falha na API externa de preços.");
    }
    if (!Array.isArray(payload.shopping_results)) throw new MarketplaceUnavailableError("Resposta inválida da API externa de preços.");

    const rejected: Record<string, number> = {};
    const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
    const offers = [];
    for (const item of payload.shopping_results as ShoppingItem[]) {
      if (typeof item.product_id !== "string" || !item.product_id || typeof item.title !== "string" || typeof item.source !== "string") { reject("invalid-listing"); continue; }
      const normalized = normalizeListing({
        source: this.id, id: item.product_id, title: item.title,
        price: typeof item.extracted_price === "number" ? item.extracted_price : NaN,
        url: typeof item.product_link === "string" ? item.product_link : typeof item.link === "string" ? item.link : "",
        storeName: item.source, checkedAt: new Date().toISOString(),
        imageUrl: typeof item.thumbnail === "string" && item.thumbnail.startsWith("https://") ? item.thumbnail : null,
        shippingPrice: null, allowedHosts: ["google.com", "google.com.br"]
      });
      if (!normalized.ok) { reject(normalized.reason); continue; }
      if (normalized.offer.product.size !== filters.size || (filters.brand && normalized.offer.product.brand !== filters.brand) || (filters.style !== "all" && normalized.offer.product.style !== filters.style)) { reject("filter-mismatch"); continue; }
      offers.push(normalized.offer);
    }
    return { offers, rejected, receivedCount: payload.shopping_results.length };
  }
}
