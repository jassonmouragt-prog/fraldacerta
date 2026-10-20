import assert from "node:assert/strict";
import test from "node:test";
import { SearchApiAdapter } from "./searchapi";
import { MarketplaceUnavailableError } from "./marketplace";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "59114250", size: "G", brand: "Pampers", style: "all", sort: "unit-price" };
const ad = { title: "Pampers Confort Sec G 80 Unidades", seller: "Loja A", domain: "loja.example", link: "https://loja.example/fralda", extracted_price: 120.5, image: "https://img.example/fralda.jpg" };

test("sem chave não consulta a rede", async () => {
  const adapter = new SearchApiAdapter({ apiKey: "", fetcher: async () => { throw new Error("rede inesperada"); } });
  await assert.rejects(adapter.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && /não configurada/i.test(error.message));
});

test("envia Bearer e parâmetros esperados em uma chamada; aceita anúncio direto e descarta agregado", async () => {
  let calls = 0;
  const adapter = new SearchApiAdapter({ apiKey: "test-secret", fetcher: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://www.searchapi.io/api/v1/search");
    assert.equal(url.searchParams.get("engine"), "google_shopping");
    assert.equal(url.searchParams.get("q"), "fralda Pampers G");
    assert.equal(url.searchParams.get("gl"), "br");
    assert.equal(url.searchParams.get("hl"), "pt-br");
    assert.equal(url.searchParams.get("link"), "raw");
    assert.equal(url.searchParams.has("location"), false);
    assert.equal(url.searchParams.has("api_key"), false);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-secret");
    return Response.json({ search_metadata: { created_at: "2026-10-20T12:00:00Z" }, shopping_ads: [ad], shopping_results: [{ product_id: "123", title: ad.title, seller: "Loja A", product_link: "https://www.google.com/shopping/product/123", extracted_price: 100 }] });
  } });
  const result = await adapter.search(filters);
  assert.equal(calls, 1);
  assert.equal(result.receivedCount, 2);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].packagePriceCents, 12050);
  assert.equal(result.offers[0].url, ad.link);
  assert.equal(result.offers[0].checkedAt, "2026-10-20T12:00:00Z");
  assert.equal(result.offers[0].shippingPriceCents, null);
  assert.deepEqual(result.rejected, { "aggregate-product": 1 });
});

test("rejeita link não resolvido, preço inválido e quantidade ambígua", async () => {
  const adapter = new SearchApiAdapter({ apiKey: "test", fetcher: async () => Response.json({ shopping_ads: [
    { ...ad, link: "https://www.google.com/goto?url=abc" },
    { ...ad, extracted_price: 0 },
    { ...ad, title: "Kit 2 Pacotes Pampers Confort Sec G 80 Unidades" }
  ] }) });
  const result = await adapter.search(filters);
  assert.equal(result.receivedCount, 3);
  assert.equal(result.offers.length, 0);
  assert.deepEqual(result.rejected, { "invalid-url": 1, "invalid-price": 1, "ambiguous-quantity": 1 });
});

test("aceita resultado com oferta direta e mantém filtros exatos", async () => {
  const adapter = new SearchApiAdapter({ apiKey: "test", fetcher: async () => Response.json({ shopping_results: [
    { ...ad, product_id: "direct-1" },
    { ...ad, title: "Pampers Confort Sec M 80 Unidades", product_id: "direct-2", link: "https://loja.example/outra" }
  ] }) });
  const result = await adapter.search(filters);
  assert.equal(result.receivedCount, 2);
  assert.equal(result.offers.length, 1);
  assert.deepEqual(result.rejected, { "filter-mismatch": 1 });
});

test("cache e deduplicação simultânea evitam chamadas extras; limite bloqueia nova consulta", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const adapter = new SearchApiAdapter({ apiKey: "test", maxRequestsPerDay: 1, fetcher: async () => { calls++; await gate; return Response.json({ shopping_ads: [ad] }); } });
  const first = adapter.search(filters);
  const simultaneous = adapter.search(filters);
  release();
  const [a, b] = await Promise.all([first, simultaneous]);
  assert.equal(calls, 1);
  assert.equal(a.offers.length, 1);
  assert.equal(b.offers.length, 1);
  await adapter.search(filters);
  assert.equal(calls, 1);
  await assert.rejects(adapter.search({ ...filters, size: "M" }), (error: unknown) => error instanceof MarketplaceUnavailableError && /limite/i.test(error.message));
});

test("401, 403 e 429 não viram ausência de produtos", async () => {
  for (const status of [401, 403, 429]) {
    const adapter = new SearchApiAdapter({ apiKey: "test", fetcher: async () => Response.json({ error: "secret response" }, { status }) });
    await assert.rejects(adapter.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && !error.message.includes("secret response"));
  }
});

test("timeout informa indisponibilidade sem expor erro de rede", async () => {
  const adapter = new SearchApiAdapter({ apiKey: "test", fetcher: async () => { throw new DOMException("private request details", "TimeoutError"); } });
  await assert.rejects(adapter.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && /Tempo limite/.test(error.message) && !error.message.includes("private"));
});

test("resolve só um agregado elegível e envia ofertas individuais ao comparador", async () => {
  let shoppingCalls = 0;
  let offersCalls = 0;
  const item = { title: "Fralda Pampers Pants Ajuste Total G 72 Unidades", seller: "Google Shopping", product_token: "token-1", product_link: "https://www.google.com/shopping/product/1", extracted_price: 110 };
  const adapter = new SearchApiAdapter({ apiKey: "secret", fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("engine") === "google_shopping") {
      shoppingCalls++;
      return Response.json({ shopping_results: [item, { ...item, product_token: "token-2" }] });
    }
    offersCalls++;
    assert.equal(url.searchParams.get("product_token"), "token-1");
    return Response.json({ offers: [{ title: "Fralda Pampers Pants Ajuste Total G 28 Unidades", extracted_price: 42, link: "https://loja.example/fralda-28", merchant: { name: "Loja A" } }] });
  } });
  const result = await adapter.search(filters);
  assert.equal(shoppingCalls, 1);
  assert.equal(offersCalls, 1);
  assert.equal(result.receivedCount, 2);
  assert.equal(result.rejected["aggregate-product"], 2);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].unitCount, 28);
  assert.equal(result.offers[0].product.imageUrl, null);
  assert.deepEqual(result.resolution, { status: "resolved", reason: undefined, sellerCount: 1 });
});
