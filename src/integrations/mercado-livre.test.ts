import assert from "node:assert/strict";
import test from "node:test";
import { MercadoLivreAdapter } from "./mercado-livre";
import { MarketplaceUnavailableError } from "./marketplace";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "01001000", size: "G", brand: null, style: "all", sort: "unit-price" };

test("sem token informa indisponibilidade sem consultar a rede", async () => {
  const adapter = new MercadoLivreAdapter({ accessToken: "", fetcher: async () => { throw new Error("não chamar"); } });
  await assert.rejects(adapter.search(filters), MarketplaceUnavailableError);
});

test("401, 403 e 429 nunca produzem ofertas", async () => {
  for (const status of [401, 403, 429]) {
    const adapter = new MercadoLivreAdapter({ accessToken: "test", fetcher: async () => new Response("{}", { status }) });
    await assert.rejects(adapter.search(filters), MarketplaceUnavailableError);
  }
});

test("usa endpoints oficiais, preserva permalink e ignora frete não confirmado", async () => {
  const urls: string[] = [];
  const adapter = new MercadoLivreAdapter({ accessToken: "test", fetcher: async (input) => {
    const url = String(input); urls.push(url);
    if (url.includes("/sites/MLB/search")) return Response.json({ results: [{ id: "MLB123456789", title: "Pampers Confort Sec G 80 Unidades", permalink: "https://www.mercadolivre.com.br/p/MLB123456789", thumbnail: null }] });
    if (url.includes("/sale_price")) return Response.json({ amount: 120, currency_id: "BRL" });
    return Response.json({ options: [] });
  } });
  const result = await adapter.search(filters);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].url, "https://www.mercadolivre.com.br/p/MLB123456789");
  assert.equal(result.offers[0].packagePriceCents, 12000);
  assert.equal(result.offers[0].shippingPriceCents, null);
  assert.ok(urls.some((url) => url.includes("/sites/MLB/search")));
  assert.ok(urls.some((url) => url.includes("/items/MLB123456789/sale_price")));
  assert.ok(urls.some((url) => url.includes("/items/MLB123456789/shipping_options?zip_code=01001000")));
});

test("rejeita permalink fora dos domínios permitidos antes de buscar preço", async () => {
  const urls: string[] = [];
  const adapter = new MercadoLivreAdapter({ accessToken: "test", fetcher: async (input) => {
    const url = String(input); urls.push(url);
    return Response.json({ results: [{ id: "MLB123456789", title: "Pampers Confort Sec G 80 Unidades", permalink: "https://mercadolivre.com.br.evil.test/item" }] });
  } });
  const result = await adapter.search(filters);
  assert.equal(result.offers.length, 0);
  assert.equal(result.rejected["invalid-url"], 1);
  assert.equal(urls.length, 1);
});
