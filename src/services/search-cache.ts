import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

export interface SearchStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  acquire(key: string, ttlSeconds: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
  reserve(searchId: string, day: string, dailyMax: number, searchMax: number): Promise<boolean>;
  confirm(searchId: string, day: string): Promise<void>;
  usage(searchId: string, day: string): Promise<{ estimated: number; confirmed: number }>;
}

export class MemorySearchStore implements SearchStore {
  private data = new Map<string, { value: unknown; expiresAt: number }>();
  private counters = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(key);
    if (!entry || entry.expiresAt <= this.now()) { this.data.delete(key); return null; }
    return entry.value as T;
  }
  async set(key: string, value: unknown, ttlSeconds: number) { this.data.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 }); }
  async acquire(key: string, ttlSeconds: number) {
    const existing = this.data.get(key);
    if (existing && existing.expiresAt > this.now()) return null;
    const token = randomUUID();
    this.data.set(key, { value: token, expiresAt: this.now() + ttlSeconds * 1000 });
    return token;
  }
  async release(key: string, token: string) { if (await this.get(key) === token) this.data.delete(key); }
  async reserve(searchId: string, day: string, dailyMax: number, searchMax: number) {
    const daily = `daily:${day}:estimated`, search = `search:${searchId}:estimated`;
    if ((this.counters.get(daily) ?? 0) >= dailyMax || (this.counters.get(search) ?? 0) >= searchMax) return false;
    this.counters.set(daily, (this.counters.get(daily) ?? 0) + 1);
    this.counters.set(search, (this.counters.get(search) ?? 0) + 1);
    return true;
  }
  async confirm(searchId: string, day: string) {
    for (const key of [`daily:${day}:confirmed`, `search:${searchId}:confirmed`]) this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  async usage(searchId: string, day: string) { void day; return { estimated: this.counters.get(`search:${searchId}:estimated`) ?? 0, confirmed: this.counters.get(`search:${searchId}:confirmed`) ?? 0 }; }
}

const RESERVE_SCRIPT = `
local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
local search = tonumber(redis.call('GET', KEYS[2]) or '0')
if daily >= tonumber(ARGV[1]) or search >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 172800)
return 1`;
const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

export class RedisSearchStore implements SearchStore {
  constructor(private readonly redis: Redis) {}
  async get<T>(key: string) { return this.redis.get<T>(key); }
  async set(key: string, value: unknown, ttlSeconds: number) { await this.redis.set(key, value, { ex: ttlSeconds }); }
  async acquire(key: string, ttlSeconds: number) {
    const token = randomUUID();
    return await this.redis.set(key, token, { nx: true, ex: ttlSeconds }) === "OK" ? token : null;
  }
  async release(key: string, token: string) { await this.redis.eval(RELEASE_SCRIPT, [key], [token]); }
  async reserve(searchId: string, day: string, dailyMax: number, searchMax: number) {
    return Number(await this.redis.eval(RESERVE_SCRIPT, [`fraldacerta:daily:${day}:estimated`, `fraldacerta:search:${searchId}:estimated`], [String(dailyMax), String(searchMax)])) === 1;
  }
  async confirm(searchId: string, day: string) {
    for (const key of [`fraldacerta:daily:${day}:confirmed`, `fraldacerta:search:${searchId}:confirmed`]) { await this.redis.incr(key); await this.redis.expire(key, 172800); }
  }
  async usage(searchId: string, day: string) {
    const [estimated, confirmed] = await Promise.all([this.redis.get<number>(`fraldacerta:search:${searchId}:estimated`), this.redis.get<number>(`fraldacerta:search:${searchId}:confirmed`)]);
    void day;
    return { estimated: Number(estimated ?? 0), confirmed: Number(confirmed ?? 0) };
  }
}

export function configuredSearchStore(): SearchStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisSearchStore(new Redis({ url, token })) : null;
}

export interface GatewayOptions { fetcher?: typeof fetch; now?: () => number; ttlSeconds?: number; dailyBudget?: number; searchBudget?: number }

function safePayload(engine: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return { error: true };
  const data = raw as Record<string, unknown>;
  const metadata = data.search_metadata as Record<string, unknown> | undefined;
  const search_metadata = { created_at: typeof metadata?.created_at === "string" ? metadata.created_at : undefined };
  if (data.error) return { error: true };
  if (engine === "google_shopping") {
    const listing = (item: unknown) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return Object.fromEntries(["title", "seller", "domain", "link", "product_link", "product_id", "brand", "price", "extracted_price", "image", "thumbnail", "product_token"].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
    };
    return { search_metadata, shopping_ads: Array.isArray(data.shopping_ads) ? data.shopping_ads.map(listing) : [], shopping_results: Array.isArray(data.shopping_results) ? data.shopping_results.map(listing) : [] };
  }
  const offer = (item: unknown) => {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const merchant = value.merchant && typeof value.merchant === "object" ? value.merchant as Record<string, unknown> : {};
    return { title: value.title, link: value.link, extracted_price: value.extracted_price, merchant: { name: merchant.name } };
  };
  return { search_metadata, offers: Array.isArray(data.offers) ? data.offers.map(offer) : [] };
}

export class SearchGateway {
  private readonly pending = new Map<string, Promise<Response>>();
  constructor(private readonly store: SearchStore, private readonly searchId: string, private readonly options: GatewayOptions = {}) {}
  dayKey() { return new Date((this.options.now ?? Date.now)()).toISOString().slice(0, 10); }
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    if (url.origin !== "https://www.searchapi.io" || url.pathname !== "/api/v1/search") return Response.json({ error: "Destino externo não permitido." }, { status: 400 });
    const engine = url.searchParams.get("engine");
    if (engine !== "google_shopping" && engine !== "google_product_offers") return Response.json({ error: "Consulta não permitida." }, { status: 400 });
    const key = `fraldacerta:provider:${createHash("sha256").update(url.pathname + url.search).digest("hex")}`;
    const stored = await this.store.get<{ status: number; body: string }>(key);
    if (stored) return new Response(stored.body, { status: stored.status, headers: { "Content-Type": "application/json" } });
    const active = this.pending.get(key);
    if (active) return (await active).clone();
    const request = this.fetchOnce(key, url, init);
    this.pending.set(key, request);
    try { return (await request).clone(); }
    finally { this.pending.delete(key); }
  }
  private async fetchOnce(key: string, url: URL, init?: RequestInit): Promise<Response> {
    const lockKey = `${key}:lock`;
    const lock = await this.store.acquire(lockKey, 45);
    if (!lock) {
      for (let i = 0; i < 80; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const cached = await this.store.get<{ status: number; body: string }>(key);
        if (cached) return new Response(cached.body, { status: cached.status, headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ error: "Consulta em andamento; tente novamente mais tarde." }, { status: 503 });
    }
    try {
      const cached = await this.store.get<{ status: number; body: string }>(key);
      if (cached) return new Response(cached.body, { status: cached.status, headers: { "Content-Type": "application/json" } });
      const day = this.dayKey();
      const reserved = await this.store.reserve(this.searchId, day, this.options.dailyBudget ?? 20, this.options.searchBudget ?? 6);
      if (!reserved) return Response.json({ error: "Orçamento de consultas atingido." }, { status: 429 });
      try {
        const response = await (this.options.fetcher ?? fetch)(url, init);
        if (response.ok) await this.store.confirm(this.searchId, day);
        const body = response.ok ? JSON.stringify(safePayload(url.searchParams.get("engine") ?? "", await response.json())) : JSON.stringify({ error: "Fonte de preços indisponível." });
        const status = response.ok && body.length > 1_000_000 ? 502 : response.status;
        const safeBody = status === 502 ? JSON.stringify({ error: "Resposta externa muito grande." }) : body;
        await this.store.set(key, { status, body: safeBody }, response.ok ? (this.options.ttlSeconds ?? 900) : 60);
        return new Response(safeBody, { status, headers: { "Content-Type": "application/json" } });
      } catch (error) {
        await this.store.set(key, { status: 503, body: JSON.stringify({ error: "Falha de rede." }) }, 60);
        throw error;
      }
    } finally { await this.store.release(lockKey, lock); }
  }
}
