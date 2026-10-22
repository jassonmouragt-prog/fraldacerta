import assert from "node:assert/strict";
import test from "node:test";
import { classifyOffer, validateAffiliateLink, chooseDestination } from "./marketplaces";

const amazon = "https://www.amazon.com.br/dp/B012345678?th=1";
const meli = "https://www.mercadolivre.com.br/p/MLB123456789";
const shopee = "https://shopee.com.br/product/12345/67890";

test("identifies stable marketplace product keys without using names", () => {
  assert.deepEqual(classifyOffer(amazon), { marketplace: "amazon", productKey: "B012345678" });
  assert.deepEqual(classifyOffer(meli), { marketplace: "mercado-livre", productKey: "MLB123456789" });
  assert.deepEqual(classifyOffer(shopee), { marketplace: "shopee", productKey: "12345:67890" });
  assert.equal(classifyOffer("https://amazon.com.br.evil.test/dp/B012345678"), null);
  assert.equal(classifyOffer("https://www.amazon.com.br/s?k=fralda"), null);
});

test("rejects unrelated, unsafe and unverifiable affiliate destinations", () => {
  assert.equal(validateAffiliateLink(amazon, "https://www.amazon.com.br/dp/B012345679?tag=official-20"), false);
  assert.equal(validateAffiliateLink(amazon, "https://amazon.com.br.evil.test/dp/B012345678"), false);
  assert.equal(validateAffiliateLink(amazon, "http://www.amazon.com.br/dp/B012345678"), false);
  assert.equal(validateAffiliateLink(amazon, "https://amzn.to/example"), false);
  assert.equal(validateAffiliateLink(meli, "https://www.mercadolivre.com.br/p/MLB123456789?tracking=official"), true);
  assert.equal(validateAffiliateLink(shopee, "https://shopee.com.br/product/12345/67890?tracking=official"), true);
});

test("missing, expired and unapproved links preserve the original offer", () => {
  const link = { url: "https://www.amazon.com.br/dp/B012345678?tag=official-20", status: "active" as const, expiresAt: null };
  assert.deepEqual(chooseDestination(amazon, null, true), { url: amazon, commissioned: false });
  assert.deepEqual(chooseDestination(amazon, link, false), { url: amazon, commissioned: false });
  assert.deepEqual(chooseDestination(amazon, { ...link, expiresAt: new Date("2020-01-01") }, true), { url: amazon, commissioned: false });
  assert.deepEqual(chooseDestination(amazon, link, true), { url: link.url, commissioned: true });
});
