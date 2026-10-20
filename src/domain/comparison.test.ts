import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateOffers, deliveredPriceCents, deliveredUnitPriceCents, filterOffers, priceToCents, sortOffers, unitPriceCents } from "./comparison";
import type { Offer, SearchFilters } from "./search";

const filters: SearchFilters = { cep: "01001000", size: "G", brand: null, style: "all", sort: "unit-price" };
const makeOffer = (id: string, brand: string, size: "G" | "XG", price: number, units: number, shipping: number | null = null): Offer => ({
  id, source: "mercado-livre", product: { id, brand, line: null, name: `${brand} ${size}`, size, style: "tape", imageUrl: null },
  store: { id: "mercado-livre", name: "Mercado Livre" }, packageCount: 1, unitsPerPackage: units, unitCount: units,
  packagePriceCents: price, unitPriceCents: price / units, shippingPriceCents: shipping,
  checkedAt: "2026-10-18T12:00:00Z", url: `https://www.mercadolivre.com.br/p/${id}`
});

test("calcula preços em centavos e preço entregue só com frete confirmado", () => {
  assert.equal(priceToCents(125.99), 12599);
  assert.equal(unitPriceCents(12599, 80), 157.4875);
  assert.equal(deliveredPriceCents(12599, 1200), 13799);
  assert.equal(deliveredPriceCents(12599, null), null);
  assert.equal(deliveredUnitPriceCents(12599, 1200, 80), 172.4875);
  assert.equal(deliveredUnitPriceCents(12599, null, 80), null);
});

test("filtra tamanho exato, marca e tipo", () => {
  const offers = [makeOffer("1", "Pampers", "G", 10000, 80), makeOffer("2", "Huggies", "G", 11000, 90), makeOffer("3", "Pampers", "XG", 9000, 80)];
  assert.deepEqual(filterOffers(offers, filters).map((offer) => offer.id), ["1", "2"]);
  assert.deepEqual(filterOffers(offers, { ...filters, brand: "Pampers", style: "pants" }), []);
});

test("deduplica anúncios e ordena por critérios de economia", () => {
  const a = makeOffer("1", "Pampers", "G", 10000, 80, 2000);
  const duplicate = { ...a, id: "copy", url: "https://produto.mercadolivre.com.br/MLB-1" };
  const b = makeOffer("2", "Huggies", "G", 9000, 60, 4000);
  assert.equal(deduplicateOffers([a, a, duplicate, b]).length, 2);
  assert.deepEqual(sortOffers([a, b], "total-price").map((offer) => offer.id), ["2", "1"]);
  assert.deepEqual(sortOffers([a, b], "unit-price").map((offer) => offer.id), ["1", "2"]);
  assert.deepEqual(sortOffers([a, b], "delivered-price").map((offer) => offer.id), ["1", "2"]);
  assert.deepEqual(sortOffers([a, { ...b, shippingPriceCents: null }], "delivered-price").map((offer) => offer.id), ["1", "2"]);
});
