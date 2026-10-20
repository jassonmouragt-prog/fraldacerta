import { createHash } from "node:crypto";
import { normalizeListing } from "@/domain/normalization";
import type { Offer, SearchFilters } from "@/domain/search";

export interface AggregateProduct {
  title?: unknown;
  product_token?: unknown;
  extracted_price?: unknown;
  thumbnail?: unknown;
  image?: unknown;
  seller?: unknown;
}

interface SellerOffer {
  title?: unknown;
  link?: unknown;
  extracted_price?: unknown;
  merchant?: { name?: unknown };
}

interface OffersPayload {
  error?: unknown;
  search_metadata?: { created_at?: unknown };
  offers?: unknown;
}

export interface ResolutionResult {
  status: "resolved" | "pending" | "unavailable";
  offers: Offer[];
  receivedCount: number;
  rejected: Record<string, number>;
  reason?: string;
  httpStatus?: number;
}

const CACHE_MS = 5 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 12_000;

function offerHost(value: unknown): { url: string; host: string } | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^[a-z0-9.-]+$/.test(host) || host === "localhost" || host.endsWith(".localhost")) return null;
    // A Google redirect does not establish the seller's destination domain.
    if (host === "google.com" || host.endsWith(".google.com") || host === "google.com.br" || host.endsWith(".google.com.br") || host === "searchapi.io" || host.endsWith(".searchapi.io")) return null;
    return { url: value, host };
  } catch { return null; }
}

export function eligibleAggregate(product: AggregateProduct, filters: SearchFilters): boolean {
  if (typeof product.product_token !== "string" || !product.product_token.trim() || typeof product.title !== "string") return false;
  // The existing normalizer supplies the conservative brand, size, style and quantity checks.
  const probe = normalizeListing({ source: "google-shopping", id: "probe", title: product.title, price: 1, url: "https://example.com/probe", storeName: "probe", checkedAt: "2026-01-01T00:00:00Z", imageUrl: null, allowedHosts: ["example.com"] });
  return probe.ok && probe.offer.product.size === filters.size && (!filters.brand || probe.offer.product.brand === filters.brand) && (filters.style === "all" || probe.offer.product.style === filters.style);
}

export function rankEligibleProducts(products: AggregateProduct[], filters: SearchFilters): AggregateProduct[] {
  const unique = new Map<string, AggregateProduct>();
  for (const product of products) if (eligibleAggregate(product, filters)) unique.set(product.product_token as string, product);
  const remaining = [...unique.values()];
  const selected: AggregateProduct[] = [];
  const seenModels = new Set<string>(), seenCounts = new Set<number>(), seenSellers = new Set<string>();
  while (remaining.length) {
    let best = 0, bestScore = -1;
    for (let index = 0; index < remaining.length; index++) {
      const product = remaining[index];
      const probe = normalizeListing({ source: "google-shopping", id: "probe", title: product.title as string, price: 1, url: "https://example.com/probe", storeName: "probe", checkedAt: "2026-01-01T00:00:00Z", imageUrl: null, allowedHosts: ["example.com"] });
      if (!probe.ok) continue;
      const model = `${probe.offer.product.line ?? ""}:${probe.offer.product.style}`;
      const seller = typeof product.seller === "string" ? product.seller : "";
      const score = (seenModels.has(model) ? 0 : 4) + (seenCounts.has(probe.offer.unitCount) ? 0 : 2) + (seller && !seenSellers.has(seller) ? 1 : 0);
      if (score > bestScore) { best = index; bestScore = score; }
    }
    const [product] = remaining.splice(best, 1);
    const probe = normalizeListing({ source: "google-shopping", id: "probe", title: product.title as string, price: 1, url: "https://example.com/probe", storeName: "probe", checkedAt: "2026-01-01T00:00:00Z", imageUrl: null, allowedHosts: ["example.com"] });
    if (probe.ok) { seenModels.add(`${probe.offer.product.line ?? ""}:${probe.offer.product.style}`); seenCounts.add(probe.offer.unitCount); }
    if (typeof product.seller === "string") seenSellers.add(product.seller);
    selected.push(product);
  }
  return selected;
}

export class ProductOffersResolver {
  private readonly cache = new Map<string, { result: ResolutionResult; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<ResolutionResult>>();
  private requests: number[] = [];

  constructor(private readonly options: { fetcher?: typeof fetch; now?: () => number; maxRequestsPerDay?: number; timeoutMs?: number } = {}) {}

  async resolve(product: AggregateProduct, filters: SearchFilters, apiKey: string, signal?: AbortSignal): Promise<ResolutionResult> {
    if (!eligibleAggregate(product, filters)) return { status: "pending", offers: [], receivedCount: 0, rejected: {}, reason: "Produto sem atributos confiáveis ou token para consultar vendedores." };
    const token = product.product_token as string;
    const now = this.options.now ?? Date.now;
    const key = `${token}\0br\0pt-br`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.result;
    const active = this.pending.get(key);
    if (active) return active;
    this.requests = this.requests.filter((time) => time > now() - WINDOW_MS);
    if (this.requests.length >= (this.options.maxRequestsPerDay ?? 5)) return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason: "Orçamento local de consultas de ofertas atingido." };
    if (signal?.aborted) return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason: "Consulta cancelada." };
    this.requests.push(now());

    const request = (async (): Promise<ResolutionResult> => {
      const url = new URL("https://www.searchapi.io/api/v1/search");
      for (const [name, value] of Object.entries({ engine: "google_product_offers", product_token: token, gl: "br", hl: "pt-br", page: "1" })) url.searchParams.set(name, value);
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? TIMEOUT_MS);
        response = await (this.options.fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch {
        return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason: "Tempo limite ou falha de rede na consulta de vendedores." };
      }
      const reason = response.status === 401 ? "Credencial do SearchAPI.io inválida." : response.status === 403 ? "Acesso à consulta de vendedores não autorizado." : response.status === 429 ? "Limite de consultas do SearchAPI.io atingido." : "Falha na API de ofertas.";
      if (!response.ok) return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason, httpStatus: response.status };
      let payload: OffersPayload;
      try { payload = await response.json() as OffersPayload; }
      catch { return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason: "Resposta inválida da API de ofertas.", httpStatus: response.status }; }
      if (!payload || payload.error || !Array.isArray(payload.offers)) return { status: "unavailable", offers: [], receivedCount: 0, rejected: {}, reason: "Resposta inválida da API de ofertas.", httpStatus: response.status };
      const checkedAt = typeof payload.search_metadata?.created_at === "string" && Number.isFinite(Date.parse(payload.search_metadata.created_at)) ? payload.search_metadata.created_at : new Date(now()).toISOString();
      const offers: Offer[] = [];
      const rejected: Record<string, number> = {};
      const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
      for (const item of payload.offers as SellerOffer[]) {
        if (!item || typeof item !== "object" || typeof item.title !== "string" || typeof item.merchant?.name !== "string") { reject("invalid-listing"); continue; }
        const destination = offerHost(item.link);
        if (!destination) { reject("invalid-url"); continue; }
        // An aggregate image may show a different pack size than the seller's offer.
        const normalized = normalizeListing({ source: "google-shopping", id: createHash("sha256").update(destination.url).digest("hex").slice(0, 20), title: item.title, price: typeof item.extracted_price === "number" ? item.extracted_price : NaN, url: destination.url, storeName: item.merchant.name, checkedAt, imageUrl: null, shippingPrice: null, allowedHosts: [destination.host] });
        if (!normalized.ok) { reject(normalized.reason); continue; }
        if (normalized.offer.product.size !== filters.size || (filters.brand && normalized.offer.product.brand !== filters.brand) || (filters.style !== "all" && normalized.offer.product.style !== filters.style)) { reject("filter-mismatch"); continue; }
        offers.push(normalized.offer);
      }
      const result: ResolutionResult = { status: "resolved", offers, receivedCount: payload.offers.length, rejected, httpStatus: response.status };
      this.cache.set(key, { result, expiresAt: now() + CACHE_MS });
      return result;
    })();
    this.pending.set(key, request);
    try { return await request; }
    finally { this.pending.delete(key); }
  }
}
