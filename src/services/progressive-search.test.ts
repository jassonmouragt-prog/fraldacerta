import assert from "node:assert/strict";
import test from "node:test";
import { MemorySearchStore } from "./search-cache";
import { ProgressiveSearchApiAdapter } from "./progressive-search";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "59114250", brand: "Pampers", size: "G", style: "all", sort: "unit-price" };
const products = ["Confort Sec G 20 Unidades", "Pants Ajuste Total G 28 Unidades", "Confort Sec G 60 Unidades"].map((name, index) => ({ title: `Fralda Pampers ${name}`, seller: "Google Shopping", product_token: `token-${index}`, product_link: `https://www.google.com/shopping/product/${index}` }));

test("busca inicial resolve dois produtos, cache reaproveita e expansão resolve só mais um", async () => {
  let shopping = 0, offers = 0;
  const store = new MemorySearchStore();
  const service = new ProgressiveSearchApiAdapter({ store, apiKey: "test", fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("engine") === "google_shopping") { shopping++; return Response.json({ shopping_results: products, search_metadata: { created_at: "2026-10-20T12:00:00Z" } }); }
    offers++;
    const index = Number(url.searchParams.get("product_token")?.split("-")[1]);
    return Response.json({ offers: [{ title: products[index].title, extracted_price: 20 + index * 10, link: `https://loja${index}.example/fralda`, merchant: { name: `Loja ${index}` } }] });
  } });
  const initial = await service.search(filters);
  assert.equal(initial.offers.length, 2);
  assert.equal(initial.progress?.hasMore, true);
  assert.equal(shopping, 1);
  assert.equal(offers, 2);
  const again = await service.search({ ...filters, cep: "59000000" });
  assert.equal(again.progress?.cached, true);
  assert.equal(again.offers.length, 2);
  assert.equal(shopping, 1);
  assert.equal(offers, 2);
  const expanded = await service.expand(filters, initial.progress!.cursor);
  assert.equal(expanded.offers.length, 3);
  assert.equal(expanded.progress?.hasMore, false);
  assert.equal(shopping, 1);
  assert.equal(offers, 3);
  const noMore = await service.expand(filters, initial.progress!.cursor);
  assert.equal(noMore.offers.length, 3);
  assert.equal(offers, 3);
  await assert.rejects(service.expand({ ...filters, brand: "Huggies" }, initial.progress!.cursor));
});

test("expansões simultâneas não resolvem o mesmo token duas vezes", async () => {
  let calls = 0;
  const store = new MemorySearchStore();
  const service = new ProgressiveSearchApiAdapter({ store, apiKey: "test", fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("engine") === "google_shopping") return Response.json({ shopping_results: products });
    calls++;
    return Response.json({ offers: [] });
  } });
  const initial = await service.search(filters);
  const [a, b] = await Promise.all([service.expand(filters, initial.progress!.cursor), service.expand(filters, initial.progress!.cursor)]);
  assert.equal(calls, 3);
  assert.equal(a.progress?.hasMore, false);
  assert.equal(b.progress?.hasMore, false);
});
