import { normalizeListing, validateOfferUrl } from "@/domain/normalization";
import type { Offer, SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "./marketplace";

interface SearchItem { id?: unknown; title?: unknown; permalink?: unknown; thumbnail?: unknown; seller?: { nickname?: unknown } }
interface SearchPayload { results?: unknown }
interface PricePayload { amount?: unknown; currency_id?: unknown }
interface ShippingPayload { options?: unknown }

const API = "https://api.mercadolibre.com";
const MAX_CANDIDATES = 12;

function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["http2.mlstatic.com", "http2.mlstatic.com.br"].includes(url.hostname) ? value : null;
  } catch { return null; }
}

export class MercadoLivreAdapter implements MarketplaceConnector {
  readonly id = "mercado-livre";
  readonly name = "Mercado Livre";
  private readonly accessToken: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { accessToken?: string; fetcher?: typeof fetch } = {}) {
    this.accessToken = options.accessToken ?? process.env.MELI_ACCESS_TOKEN ?? "";
    this.fetcher = options.fetcher ?? fetch;
  }

  private async getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
      cache: "no-store", signal
    });
    if ([401, 403, 429].includes(response.status)) throw new MarketplaceUnavailableError(`Acesso à API indisponível (${response.status}).`);
    if (!response.ok) throw new Error(`Mercado Livre respondeu ${response.status}.`);
    return response.json() as Promise<T>;
  }

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    if (!this.accessToken) throw new MarketplaceUnavailableError("Acesso à API ainda não configurado.");
    const query = ["fralda", filters.brand, filters.size].filter(Boolean).join(" ");
    const url = new URL(`${API}/sites/MLB/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(MAX_CANDIDATES));
    const payload = await this.getJson<SearchPayload>(url.toString(), signal);
    if (!Array.isArray(payload.results)) throw new Error("Resposta de busca inválida do Mercado Livre.");

    const rejected: Record<string, number> = {};
    const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
    const candidates: { id: string; title: string; permalink: string; image: string | null; storeName: string }[] = [];
    for (const item of (payload.results as SearchItem[]).slice(0, MAX_CANDIDATES)) {
      if (typeof item.id !== "string" || !/^MLB\d+$/.test(item.id) || typeof item.title !== "string" || typeof item.permalink !== "string") { reject("invalid-listing"); continue; }
      if (!validateOfferUrl(item.permalink)) { reject("invalid-url"); continue; }
      const storeName = typeof item.seller?.nickname === "string" && item.seller.nickname.trim() ? item.seller.nickname : "Mercado Livre";
      const probe = normalizeListing({ source: this.id, id: item.id, title: item.title, price: 1, url: item.permalink, storeName, checkedAt: new Date().toISOString(), imageUrl: null });
      if (!probe.ok) { reject(probe.reason); continue; }
      if (probe.offer.product.size !== filters.size || (filters.brand && probe.offer.product.brand !== filters.brand) || (filters.style !== "all" && probe.offer.product.style !== filters.style)) continue;
      candidates.push({ id: item.id, title: item.title, permalink: item.permalink, image: imageUrl(item.thumbnail), storeName });
    }

    const offers = await Promise.all(candidates.map(async (item): Promise<Offer | null> => {
      let price: PricePayload;
      try {
        price = await this.getJson<PricePayload>(`${API}/items/${item.id}/sale_price?context=channel_marketplace`, signal);
      } catch (error) {
        if (error instanceof MarketplaceUnavailableError) throw error;
        reject("price-unavailable"); return null;
      }
      if (price.currency_id !== "BRL" || typeof price.amount !== "number") { reject("invalid-price"); return null; }
      let shippingPrice: number | null = null;
      try {
        const shipping = await this.getJson<ShippingPayload>(`${API}/items/${item.id}/shipping_options?zip_code=${filters.cep}`, signal);
        if (Array.isArray(shipping.options)) {
          const costs = shipping.options
            .filter((option): option is { shipping_option_type: string; cost: number } => typeof option === "object" && option !== null && option.shipping_option_type === "address" && typeof option.cost === "number" && Number.isFinite(option.cost) && option.cost >= 0)
            .map((option) => option.cost);
          if (costs.length) shippingPrice = Math.min(...costs);
        }
      } catch (error) {
        if (error instanceof MarketplaceUnavailableError) throw error;
        // A falha de cotação não comprova nem frete grátis nem disponibilidade.
      }
      const normalized = normalizeListing({ source: this.id, id: item.id, title: item.title, price: price.amount, url: item.permalink, storeName: item.storeName, checkedAt: new Date().toISOString(), imageUrl: item.image, shippingPrice });
      if (!normalized.ok) { reject(normalized.reason); return null; }
      return normalized.offer;
    }));
    return { offers: offers.filter((offer): offer is Offer => offer !== null), rejected };
  }
}
