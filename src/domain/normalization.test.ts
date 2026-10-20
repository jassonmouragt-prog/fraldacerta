import assert from "node:assert/strict";
import test from "node:test";
import { normalizeListing, validateOfferUrl } from "./normalization";

const base = { source: "mercado-livre", id: "MLB123456789", price: 120, url: "https://www.mercadolivre.com.br/fralda/p/MLB123456789", storeName: "Loja", checkedAt: "2026-10-18T12:00:00Z", imageUrl: null };

test("identifica marca, linha, tamanho exato e unidades", () => {
  const result = normalizeListing({ ...base, title: "Pampers Confort Sec G 80 Unidades" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.offer.product.brand, "Pampers");
  assert.equal(result.offer.product.line, "Confort Sec");
  assert.equal(result.offer.product.size, "G");
  assert.equal(result.offer.unitCount, 80);
  assert.equal(result.offer.packageCount, 1);
  assert.equal(result.offer.unitPriceCents, 150);
});

test("kit com unidades por pacote multiplica apenas uma vez", () => {
  const result = normalizeListing({ ...base, title: "Kit 3 Pacotes Huggies Supreme Care M 48 Un Cada" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.offer.unitCount, 144);
  assert.equal(result.offer.packageCount, 3);
  assert.equal(result.offer.unitsPerPackage, 48);
});

test("kit com total explícito não multiplica novamente", () => {
  const result = normalizeListing({ ...base, title: "Kit 3 Pacotes Huggies Supreme Care M 144 Unidades No Total" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.offer.unitCount, 144);
});

test("kit rejeita total conflitante com unidades por pacote", () => {
  const result = normalizeListing({ ...base, title: "Kit 3 Pacotes Huggies Supreme Care M 48 Un Cada 120 Un Total" });
  assert.deepEqual(result, { ok: false, reason: "ambiguous-quantity" });
});

test("fralda calça Babysec é identificada", () => {
  const result = normalizeListing({ ...base, title: "Fralda Calça Babysec XG 60 Unidades" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.offer.product.brand, "Babysec");
  assert.equal(result.offer.product.style, "pants");
  assert.equal(result.offer.product.size, "XG");
});

test("rejeita quantidade ambígua e tamanho GG em vez de G", () => {
  const ambiguous = normalizeListing({ ...base, title: "Kit 3 Pacotes Huggies Supreme Care M 48 Unidades" });
  assert.deepEqual(ambiguous, { ok: false, reason: "ambiguous-quantity" });
  const wrongSize = normalizeListing({ ...base, title: "Pampers Confort Sec GG 80 Unidades" });
  assert.deepEqual(wrongSize, { ok: false, reason: "unsupported-size" });
});

test("rejeita URL não permitida e dados inválidos", () => {
  assert.equal(validateOfferUrl("https://mercadolivre.com.br.evil.test/produto"), false);
  assert.equal(validateOfferUrl("http://www.mercadolivre.com.br/produto"), false);
  assert.equal(validateOfferUrl(base.url), true);
  assert.equal(validateOfferUrl("https://www.amazon.com.br/produto", ["amazon.com.br"]), true);
  assert.equal(validateOfferUrl("https://amazon.com.br.evil.test/produto", ["amazon.com.br"]), false);
  assert.deepEqual(normalizeListing({ ...base, title: "Pampers Confort Sec G 80 Unidades", price: -1 }), { ok: false, reason: "invalid-price" });
});
