import assert from "node:assert/strict";
import test from "node:test";
import { MemorySearchStore, SearchGateway } from "./search-cache";

test("cache compartilhado reutiliza resposta e expira pelo TTL", async () => {
  let now = 1_000;
  let calls = 0;
  const store = new MemorySearchStore(() => now);
  const gateway = new SearchGateway(store, "search-1", { now: () => now, ttlSeconds: 10, fetcher: async () => { calls++; return Response.json({ shopping_results: [] }); } });
  const url = "https://www.searchapi.io/api/v1/search?engine=google_shopping&q=fralda+Pampers+G";
  assert.equal((await gateway.fetch(url)).status, 200);
  assert.equal((await gateway.fetch(url)).status, 200);
  assert.equal(calls, 1);
  now += 10_001;
  assert.equal((await gateway.fetch(url)).status, 200);
  assert.equal(calls, 2);
});

test("requisições simultâneas reservam uma vez e deduplicam", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new MemorySearchStore();
  const gateway = new SearchGateway(store, "search-1", { fetcher: async () => { calls++; await gate; return Response.json({ offers: [] }); } });
  const url = "https://www.searchapi.io/api/v1/search?engine=google_product_offers&product_token=one";
  const a = gateway.fetch(url);
  const b = gateway.fetch(url);
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await store.usage("search-1", gateway.dayKey()), { estimated: 1, confirmed: 1 });
});

test("orçamento diário e por pesquisa bloqueia sem chamar fornecedor", async () => {
  let calls = 0;
  const store = new MemorySearchStore();
  const gateway = new SearchGateway(store, "search-1", { dailyBudget: 2, searchBudget: 1, fetcher: async () => { calls++; return Response.json({ offers: [] }); } });
  const base = "https://www.searchapi.io/api/v1/search?engine=google_product_offers&product_token=";
  await gateway.fetch(base + "one");
  assert.equal((await gateway.fetch(base + "two")).status, 429);
  assert.equal(calls, 1);
  const second = new SearchGateway(store, "search-2", { dailyBudget: 2, searchBudget: 1, fetcher: async () => { calls++; return Response.json({ offers: [] }); } });
  await second.fetch(base + "three");
  assert.equal((await second.fetch(base + "four")).status, 429);
  assert.equal(calls, 2);
});

test("falha ou interrupção mantém crédito estimado reservado", async () => {
  const store = new MemorySearchStore();
  const gateway = new SearchGateway(store, "search-1", { fetcher: async () => { throw new Error("network"); } });
  await assert.rejects(gateway.fetch("https://www.searchapi.io/api/v1/search?engine=google_shopping&q=a"));
  assert.deepEqual(await store.usage("search-1", gateway.dayKey()), { estimated: 1, confirmed: 0 });
});

test("cache persiste apenas campos necessários sem metadados sensíveis", async () => {
  const store = new MemorySearchStore();
  const gateway = new SearchGateway(store, "search-1", { fetcher: async () => Response.json({ search_metadata: { created_at: "2026-10-20T12:00:00Z", private_key: "secret" }, shopping_results: [], unrelated: "secret" }) });
  const response = await gateway.fetch("https://www.searchapi.io/api/v1/search?engine=google_shopping&q=a");
  const body = await response.text();
  assert.equal(body.includes("secret"), false);
  assert.equal(JSON.parse(body).search_metadata.created_at, "2026-10-20T12:00:00Z");
});
