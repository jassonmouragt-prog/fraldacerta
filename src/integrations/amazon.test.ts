import assert from "node:assert/strict";
import test from "node:test";
import { AmazonAdapter } from "./amazon";
import { MarketplaceUnavailableError } from "./marketplace";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "01001000", size: "G", brand: "Pampers", style: "all", sort: "unit-price" };
const credentials = { clientId: "client-test", clientSecret: "secret-test", partnerTag: "example-20" };

function item(url = "https://www.amazon.com.br/dp/B012345678?tag=example-20") {
  return { asin: "B012345678", detailPageURL: url, itemInfo: { title: { displayValue: "Pampers Confort Sec G 80 Unidades" } }, images: { primary: { medium: { url: "https://m.media-amazon.com/images/example.jpg" } } }, offersV2: { listings: [{ condition: { value: "New" }, availability: { type: "IN_STOCK" }, price: { money: { amount: 99.90, currency: "BRL" } }, merchantInfo: { name: "Loja oficial" } }] } };
}

test("Amazon sem credenciais não chama a rede", async () => {
  const adapter = new AmazonAdapter({ clientId: "", clientSecret: "", partnerTag: "", fetcher: async () => { throw new Error("não chamar"); } });
  await assert.rejects(adapter.search(filters), MarketplaceUnavailableError);
});

test("Amazon consulta SearchItems com marca, token server-side e OffersV2", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const adapter = new AmazonAdapter({ ...credentials, now: () => Date.parse("2026-10-18T12:00:00Z"), fetcher: async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).includes("/auth/o2/token")) return Response.json({ access_token: "token-test", expires_in: 3600 });
    return Response.json({ searchResult: { items: [item()] } });
  } });
  const found = await adapter.search(filters);
  assert.equal(found.offers.length, 1);
  assert.equal(found.offers[0].packagePriceCents, 9990);
  assert.equal(found.offers[0].unitPriceCents, 9990 / 80);
  assert.equal(found.offers[0].shippingPriceCents, null);
  assert.equal(found.offers[0].origin, "live");
  assert.equal(found.offers[0].url, item().detailPageURL);
  assert.equal(calls[0].url, "https://api.amazon.com/auth/o2/token");
  assert.equal(calls[1].url, "https://creatorsapi.amazon/catalog/v1/searchItems");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.brand, "Pampers");
  assert.equal(body.keywords, "fralda G");
  assert.equal(body.condition, "Any");
  assert.ok(body.resources.includes("offersV2.listings.price"));
  await adapter.search(filters);
  assert.equal(calls.filter((call) => call.url.includes("/auth/o2/token")).length, 1);
});

test("Amazon usa menor preço novo retornado, informa usado e ignora oferta exclusiva Prime", async () => {
  const candidate = { ...item(), offersV2: { listings: [
    { condition: { value: "New" }, availability: { type: "IN_STOCK" }, price: { money: { amount: 120, currency: "BRL" } }, merchantInfo: { name: "Loja" } },
    { condition: { value: "Used" }, availability: { type: "IN_STOCK" }, price: { money: { amount: 80, currency: "BRL" } }, merchantInfo: { name: "Loja" } },
    { condition: { value: "New" }, availability: { type: "IN_STOCK" }, price: { money: { amount: 90, currency: "BRL" } }, merchantInfo: { name: "Loja" }, dealDetails: { accessType: "PRIME_EXCLUSIVE" } }
  ] } };
  const adapter = new AmazonAdapter({ ...credentials, fetcher: async (input) => String(input).includes("/auth/o2/token") ? Response.json({ access_token: "token", expires_in: 3600 }) : Response.json({ searchResult: { items: [candidate] } }) });
  const found = await adapter.search(filters);
  assert.equal(found.offers[0].packagePriceCents, 12000);
  assert.equal(found.offers[0].usedPriceCents, 8000);
});

test("Amazon rejeita link sem tag, anúncio sem preço e erro de API", async () => {
  const adapter = new AmazonAdapter({ ...credentials, fetcher: async (input) => String(input).includes("/auth/o2/token") ? Response.json({ access_token: "token", expires_in: 3600 }) : Response.json({ searchResult: { items: [item("https://evil.test/item"), { ...item(), asin: "B000000001", offersV2: { listings: [] } }] } }) });
  const found = await adapter.search(filters);
  assert.equal(found.offers.length, 0);
  assert.equal(found.rejected["invalid-listing"], 1);
  assert.equal(found.rejected["price-unavailable"], 1);
  const denied = new AmazonAdapter({ ...credentials, fetcher: async (input) => String(input).includes("/auth/o2/token") ? Response.json({ access_token: "token", expires_in: 3600 }) : new Response("{}", { status: 403 }) });
  await assert.rejects(denied.search(filters), MarketplaceUnavailableError);
});
