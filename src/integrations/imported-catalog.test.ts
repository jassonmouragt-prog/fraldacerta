import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogSignature, ImportedCatalogAdapter } from "./imported-catalog";
import { MarketplaceUnavailableError } from "./marketplace";
import type { SearchFilters } from "../domain/search";

const now = Date.parse("2026-10-18T12:00:00Z");
const filters: SearchFilters = { cep: "01001000", size: "G", brand: null, style: "all", sort: "unit-price" };
const row = { id: "item-1", store: "Parceiro autorizado", product: "Pampers Confort Sec G 80 Unidades", brand: "Pampers", size: "G", style: "tape", quantity: 80, price: 120, url: "https://www.paguemenos.com.br/produto/1", checkedAt: "2026-10-18T11:00:00Z", available: true, shippingPrice: 10, shippingCep: "01001000", deliveryConfirmed: true };

async function fixture(extension: "json" | "csv", contents: string, run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "fraldacerta-catalog-"));
  const path = join(directory, `partner.${extension}`);
  try {
    await writeFile(path, contents);
    await writeFile(`${path}.sig`, catalogSignature(contents, "key-test"));
    await run(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function adapter(path: string) { return new ImportedCatalogAdapter({ path, key: "key-test", partner: "parceiro-1", allowedHosts: ["paguemenos.com.br"], now: () => now }); }

test("catálogo JSON assinado preserva data, preço e frete confirmado apenas no CEP", async () => {
  await fixture("json", JSON.stringify([row]), async (path) => {
    const found = await adapter(path).search(filters);
    assert.equal(found.offers.length, 1);
    assert.equal(found.offers[0].origin, "imported");
    assert.equal(found.offers[0].shippingPriceCents, 1000);
    assert.equal(found.offers[0].checkedAt, row.checkedAt);
    const otherCep = await adapter(path).search({ ...filters, cep: "22041001" });
    assert.equal(otherCep.offers[0].shippingPriceCents, null);
  });
});

test("catálogo CSV assinado importa registros válidos", async () => {
  const headers = Object.keys(row);
  const contents = `${headers.join(",")}\n${headers.map((key) => String(row[key as keyof typeof row])).join(",")}\n`;
  await fixture("csv", contents, async (path) => { assert.equal((await adapter(path).search(filters)).offers.length, 1); });
});

test("catálogo rejeita assinatura alterada, preço antigo, atributos conflitantes e domínio estranho", async () => {
  await fixture("json", JSON.stringify([row]), async (path) => {
    await writeFile(path, JSON.stringify([{ ...row, price: 1 }]));
    await assert.rejects(adapter(path).search(filters), MarketplaceUnavailableError);
  });
  await fixture("json", JSON.stringify([{ ...row, checkedAt: "2026-10-15T11:00:00Z" }, { ...row, id: "2", quantity: 48 }, { ...row, id: "3", url: "https://evil.test/item" }]), async (path) => {
    const found = await adapter(path).search(filters);
    assert.equal(found.offers.length, 0);
    assert.equal(found.rejected["stale-row"], 1);
    assert.equal(found.rejected["attribute-mismatch"], 1);
    assert.equal(found.rejected["invalid-url"], 1);
  });
});
