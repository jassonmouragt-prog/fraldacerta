import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deduplicateOffers } from "@/domain/comparison";
import type { SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "@/integrations/marketplace";
import { SearchApiAdapter } from "@/integrations/searchapi";
import { configuredSearchStore, SearchGateway, type SearchStore } from "./search-cache";

interface StoredSearch {
  result: ConnectorSearchResult;
  attemptedTokens: string[];
  collectedAt: string;
  expiresAt: number;
}

interface Options {
  store?: SearchStore | null;
  fetcher?: typeof fetch;
  apiKey?: string;
  now?: () => number;
  ttlSeconds?: number;
  dailyBudget?: number;
  searchBudget?: number;
}

export class ProgressiveSearchApiAdapter implements MarketplaceConnector {
  readonly id = "google-shopping";
  readonly name = "SearchAPI.io Google Shopping";
  private readonly store: SearchStore | null;
  constructor(private readonly options: Options = {}) { this.store = options.store === undefined ? configuredSearchStore() : options.store; }

  private get now() { return this.options.now ?? Date.now; }
  private get ttl() { return Math.max(60, Math.min(3600, this.options.ttlSeconds ?? (Number(process.env.SEARCH_CACHE_TTL_SECONDS) || 900))); }
  private get dailyBudget() { return Math.max(1, Math.min(100, this.options.dailyBudget ?? (Number(process.env.SEARCH_DAILY_CREDIT_BUDGET) || 20))); }
  private get searchBudget() { return Math.max(1, Math.min(10, this.options.searchBudget ?? (Number(process.env.SEARCH_CREDIT_LIMIT_PER_QUERY) || 6))); }
  private get apiKey() { return (this.options.apiKey ?? process.env.SEARCHAPI_API_KEY)?.trim(); }

  private context(filters: SearchFilters) {
    const normalized = JSON.stringify({ engine: "google_shopping", brand: filters.brand, size: filters.size, style: filters.style, gl: "br", hl: "pt-br", link: "raw" });
    const id = createHash("sha256").update(normalized).digest("hex");
    const secret = this.apiKey ?? "";
    const cursor = createHmac("sha256", secret).update(id).digest("hex");
    return { id, cursor, key: `fraldacerta:state:${id}`, lockKey: `fraldacerta:state:${id}:lock` };
  }

  private requireConfigured() {
    if (!this.apiKey) throw new MarketplaceUnavailableError("Credencial do SearchAPI.io não configurada.");
    if (!this.store) throw new MarketplaceUnavailableError("Cache compartilhado e orçamento de créditos não configurados.");
    return this.store;
  }

  private async getState(key: string): Promise<StoredSearch | null> {
    const state = await this.requireConfigured().get<StoredSearch>(key);
    return state && state.expiresAt > this.now() ? state : null;
  }

  private gateway(id: string) {
    return new SearchGateway(this.requireConfigured(), id, { fetcher: this.options.fetcher, now: this.now, ttlSeconds: this.ttl, dailyBudget: this.dailyBudget, searchBudget: this.searchBudget });
  }

  private async locked<T>(key: string, lockKey: string, action: () => Promise<T>, onBusy: () => Promise<T>): Promise<T> {
    const store = this.requireConfigured();
    const lock = await store.acquire(lockKey, 45);
    if (!lock) {
      for (let i = 0; i < 80; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!await store.get(lockKey)) return onBusy();
      }
      throw new MarketplaceUnavailableError("Consulta em andamento. Aguarde alguns instantes.");
    }
    try { return await action(); }
    finally { await store.release(lockKey, lock); }
  }

  private present(state: StoredSearch, cursor: string, cached: boolean): ConnectorSearchResult {
    return { ...state.result, progress: { cursor, hasMore: state.result.progress?.hasMore ?? false, cached }, attemptedTokens: undefined, collectedAt: state.collectedAt };
  }

  async search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    this.requireConfigured();
    const { id, cursor, key, lockKey } = this.context(filters);
    const cached = await this.getState(key);
    if (cached) return this.present(cached, cursor, true);
    return this.locked(key, lockKey, async () => {
      const existing = await this.getState(key);
      if (existing) return this.present(existing, cursor, true);
      const gateway = this.gateway(id);
      const adapter = new SearchApiAdapter({ apiKey: this.apiKey, fetcher: gateway.fetch.bind(gateway), now: this.now, maxProductResolutionsPerSearch: 2 });
      const result = await adapter.searchWithControl(filters, { limit: 2 }, signal);
      const usage = await this.requireConfigured().usage(id, gateway.dayKey());
      result.progress = { cursor, hasMore: !!result.progress?.hasMore && usage.estimated < this.searchBudget, cached: false };
      const state: StoredSearch = { result, attemptedTokens: result.attemptedTokens ?? [], collectedAt: new Date(this.now()).toISOString(), expiresAt: this.now() + this.ttl * 1000 };
      await this.requireConfigured().set(key, state, this.ttl);
      return this.present(state, cursor, false);
    }, async () => {
      const ready = await this.getState(key);
      if (!ready) throw new MarketplaceUnavailableError("Consulta em andamento. Aguarde alguns instantes.");
      return this.present(ready, cursor, true);
    });
  }

  async expand(filters: SearchFilters, cursor: string, signal?: AbortSignal): Promise<ConnectorSearchResult> {
    this.requireConfigured();
    const context = this.context(filters);
    const provided = Buffer.from(cursor, "hex"), expected = Buffer.from(context.cursor, "hex");
    if (!/^[a-f0-9]{64}$/.test(cursor) || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new MarketplaceUnavailableError("Identificador de pesquisa inválido.");
    return this.locked(context.key, context.lockKey, async () => {
      const state = await this.getState(context.key);
      if (!state) throw new MarketplaceUnavailableError("Pesquisa expirada. Faça uma nova busca.");
      if (!state.result.progress?.hasMore) return this.present(state, context.cursor, true);
      const gateway = this.gateway(context.id);
      const adapter = new SearchApiAdapter({ apiKey: this.apiKey, fetcher: gateway.fetch.bind(gateway), now: this.now, maxProductResolutionsPerSearch: 1 });
      const found = await adapter.searchWithControl(filters, { limit: 1, skipTokens: state.attemptedTokens }, signal);
      const attemptedTokens = [...new Set([...state.attemptedTokens, ...(found.attemptedTokens ?? [])])];
      const rejected = { ...state.result.rejected };
      for (const [reason, count] of Object.entries(found.rejected)) rejected[reason] = Math.max(rejected[reason] ?? 0, count);
      const usage = await this.requireConfigured().usage(context.id, gateway.dayKey());
      const result: ConnectorSearchResult = {
        offers: deduplicateOffers([...state.result.offers, ...found.offers]), rejected, receivedCount: state.result.receivedCount,
        resolution: found.resolution?.status === "unavailable" ? found.resolution : { status: "resolved", sellerCount: (state.result.resolution?.sellerCount ?? 0) + (found.resolution?.sellerCount ?? 0) },
        progress: { cursor: context.cursor, hasMore: !!found.progress?.hasMore && usage.estimated < this.searchBudget, cached: false }, attemptedTokens
      };
      const updated: StoredSearch = { result, attemptedTokens, collectedAt: new Date(this.now()).toISOString(), expiresAt: state.expiresAt };
      await this.requireConfigured().set(context.key, updated, Math.max(1, Math.ceil((state.expiresAt - this.now()) / 1000)));
      return this.present(updated, context.cursor, false);
    }, async () => {
      const state = await this.getState(context.key);
      if (!state) throw new MarketplaceUnavailableError("Pesquisa expirada. Faça uma nova busca.");
      return this.present(state, context.cursor, true);
    });
  }
}
