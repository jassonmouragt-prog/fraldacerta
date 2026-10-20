import assert from "node:assert/strict";
import test from "node:test";
import { orchestrateSearch } from "./search-server";
import type { MarketplaceConnector } from "../integrations/marketplace";
import type { Offer } from "../domain/search";

const input = { cep: "01001000", cepConfirmed: true, size: "G", brand: null, style: "all", sort: "unit-price" };
const offer: Offer = { id: "1", source: "test", product: { id: "1", brand: "Pampers", line: "Confort Sec", name: "Pampers Confort Sec G 80 Unidades", size: "G", style: "tape", imageUrl: null }, store: { id: "test", name: "Teste" }, packageCount: 1, unitsPerPackage: 80, unitCount: 80, packagePriceCents: 10000, unitPriceCents: 125, shippingPriceCents: null, checkedAt: "2026-10-18T12:00:00Z", url: "https://www.mercadolivre.com.br/p/1" };

test("orquestra fontes em paralelo e isola falha", async () => {
  const ok: MarketplaceConnector = { id: "ok", search: async () => ({ offers: [offer], rejected: {} }) };
  const fail: MarketplaceConnector = { id: "fail", search: async () => { throw new Error("401"); } };
  const result = await orchestrateSearch(input, [ok, fail]);
  assert.equal(result.count, 1);
  assert.equal(result.sources.find((source) => source.id === "ok")?.status, "success");
  assert.equal(result.sources.find((source) => source.id === "fail")?.status, "failed");
});

test("rejeita entrada inválida", async () => {
  await assert.rejects(orchestrateSearch({ ...input, size: "GG" }, []));
});
