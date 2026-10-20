import assert from "node:assert/strict";
import test from "node:test";
import { GoogleShoppingAdapter } from "./google-shopping";
import { MarketplaceUnavailableError } from "./marketplace";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "59114250", size: "G", brand: "Pampers", style: "all", sort: "unit-price" };

test("chave ausente não consulta a rede", async () => {
  const adapter = new GoogleShoppingAdapter({ apiKey: "", fetcher: async () => { throw new Error("rede não deveria ser consultada"); } });
  await assert.rejects(adapter.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && /não configurada/i.test(error.message));
});

test("401 e 429 informam autenticação e limite sem expor resposta externa", async () => {
  for (const [status, expected] of [[401, /inválida/i], [429, /limite/i]] as const) {
    const adapter = new GoogleShoppingAdapter({ apiKey: "secret-test", fetcher: async () => Response.json({ error: "secret-test" }, { status }) });
    await assert.rejects(adapter.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && expected.test(error.message) && !error.message.includes("secret-test"));
  }
});

test("resposta vazia é busca sem produtos; falha externa permanece indisponibilidade", async () => {
  const empty = new GoogleShoppingAdapter({ apiKey: "test", fetcher: async () => Response.json({ shopping_results: [] }) });
  assert.deepEqual(await empty.search(filters), { offers: [], rejected: {}, receivedCount: 0 });
  const failed = new GoogleShoppingAdapter({ apiKey: "test", fetcher: async () => Response.json({ error: "private upstream detail" }, { status: 503 }) });
  await assert.rejects(failed.search(filters), (error: unknown) => error instanceof MarketplaceUnavailableError && /API externa/.test(error.message) && !error.message.includes("private"));
});

test("consulta Google Shopping sem localização, normaliza preços e conta descartes", async () => {
  let calls = 0;
  const adapter = new GoogleShoppingAdapter({ apiKey: "secret-test", fetcher: async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("engine"), "google_shopping");
    assert.equal(url.searchParams.get("q"), "fralda Pampers G");
    assert.equal(url.searchParams.get("gl"), "br");
    assert.equal(url.searchParams.get("hl"), "pt-br");
    assert.equal(url.searchParams.has("location"), false);
    assert.equal(url.searchParams.get("api_key"), "secret-test");
    return Response.json({ shopping_results: [
      { product_id: "123", title: "Pampers Confort Sec G 80 Unidades", extracted_price: 120.5, source: "Loja", product_link: "https://www.google.com/shopping/product/123" },
      { product_id: "124", title: "Pampers G 80 Unidades", extracted_price: 99, source: "Loja", product_link: "https://www.google.com/shopping/product/124" },
      { product_id: "125", title: "Pampers Confort Sec G 80 Unidades", extracted_price: 110, source: "Loja", product_link: "https://evil.test/product" }
    ] });
  } });
  const result = await adapter.search(filters);
  assert.equal(calls, 1);
  assert.equal(result.receivedCount, 3);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].packagePriceCents, 12050);
  assert.equal(result.offers[0].shippingPriceCents, null);
  assert.deepEqual(result.rejected, { "unknown-style": 1, "invalid-url": 1 });
});
