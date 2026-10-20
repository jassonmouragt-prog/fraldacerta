import assert from "node:assert/strict";
import test from "node:test";
import { eligibleAggregate, rankEligibleProducts, ProductOffersResolver } from "./product-offers-resolver";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "59114250", size: "G", brand: "Pampers", style: "all", sort: "unit-price" };
const product = { title: "Fralda Pampers Pants Ajuste Total G 72 Unidades", product_token: "token-from-shopping", thumbnail: "https://img.example/p.jpg" };
const payload = { search_metadata: { created_at: "2026-10-20T12:00:00Z" }, offers: [
  { title: product.title, link: "https://loja.example/pampers", extracted_price: 108, merchant: { name: "Loja A" } },
  { title: product.title, link: "https://www.google.com/url?q=https://loja.example/pampers", extracted_price: 105, merchant: { name: "Loja B" } },
  { title: "Pampers Pants G", link: "https://loja2.example/pampers", extracted_price: 90, merchant: { name: "Loja C" } }
] };

test("seleciona somente produto com token e atributos exatos", () => {
  assert.equal(eligibleAggregate(product, filters), true);
  assert.equal(eligibleAggregate({ ...product, product_token: undefined }, filters), false);
  assert.equal(eligibleAggregate({ ...product, title: "Fralda Pampers Pants XG 72 Unidades" }, filters), false);
  assert.equal(eligibleAggregate({ ...product, title: "Fralda Pampers Pants G" }, filters), false);
});

test("prioriza modelos e quantidades distintos sem repetir token", () => {
  const items = [
    product,
    { ...product, product_token: "second", title: "Fralda Pampers Pants Ajuste Total G 72 Unidades" },
    { ...product, product_token: "third", title: "Fralda Pampers Confort Sec G 20 Unidades" }
  ];
  assert.deepEqual(rankEligibleProducts(items, filters).map((item) => item.product_token), ["token-from-shopping", "third", "second"]);
});

test("consulta token uma vez, normaliza vendedor direto e preserva ausência de frete", async () => {
  let calls = 0;
  const resolver = new ProductOffersResolver({ fetcher: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("engine"), "google_product_offers");
    assert.equal(url.searchParams.get("product_token"), product.product_token);
    assert.equal(url.searchParams.has("product_id"), false);
    assert.equal(url.searchParams.get("gl"), "br");
    assert.equal(url.searchParams.get("hl"), "pt-br");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
    return Response.json(payload);
  } });
  const [first, concurrent] = await Promise.all([resolver.resolve(product, filters, "secret"), resolver.resolve(product, filters, "secret")]);
  assert.equal(calls, 1);
  assert.deepEqual(first, concurrent);
  assert.equal(first.httpStatus, 200);
  assert.equal(first.receivedCount, 3);
  assert.equal(first.offers.length, 1);
  assert.equal(first.offers[0].store.name, "Loja A");
  assert.equal(first.offers[0].url, "https://loja.example/pampers");
  assert.equal(first.offers[0].unitPriceCents, 150);
  assert.equal(first.offers[0].shippingPriceCents, null);
  assert.equal(first.offers[0].checkedAt, "2026-10-20T12:00:00Z");
  assert.deepEqual(first.rejected, { "invalid-url": 1, "missing-quantity": 1 });
  await resolver.resolve(product, filters, "secret");
  assert.equal(calls, 1);
});

test("erros de autenticação e cota são indisponibilidade sanitizada", async () => {
  for (const status of [401, 403, 429]) {
    const resolver = new ProductOffersResolver({ fetcher: async () => Response.json({ error: "secret" }, { status }) });
    const result = await resolver.resolve(product, filters, "secret");
    assert.equal(result.status, "unavailable");
    assert.equal(result.httpStatus, status);
    assert.equal(result.offers.length, 0);
    assert.equal(result.reason?.includes("secret"), false);
  }
});

test("orçamento local impede segunda consulta de token distinto", async () => {
  let calls = 0;
  const resolver = new ProductOffersResolver({ maxRequestsPerDay: 1, fetcher: async () => { calls++; return Response.json(payload); } });
  await resolver.resolve(product, filters, "secret");
  const blocked = await resolver.resolve({ ...product, product_token: "other" }, filters, "secret");
  assert.equal(calls, 1);
  assert.equal(blocked.status, "unavailable");
});
