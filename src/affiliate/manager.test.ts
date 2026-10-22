import assert from "node:assert/strict";
import test from "node:test";
import type { Offer } from "../domain/search";
import { AffiliateManager, type AffiliateRepository, type StoredAffiliateOffer, type StoredAffiliateLink } from "./manager";

const offer = (id: string, price: number): Offer => ({
  id, source: "google-shopping", product: { id, brand: "Pampers", line: null, name: "Pampers", size: "G", style: "tape", imageUrl: null },
  store: { id: "amazon", name: "Amazon Brasil" }, unitCount: 20, packageCount: 1, unitsPerPackage: 20,
  packagePriceCents: price, unitPriceCents: price / 20, shippingPriceCents: null, checkedAt: "2026-10-22T00:00:00Z",
  url: "https://www.amazon.com.br/dp/B012345678"
});

test("matches a link only to its exact stable offer and product", async () => {
  const rows = new Map<string, StoredAffiliateOffer>();
  const links = new Map<string, StoredAffiliateLink>();
  const clicks: string[] = [];
  const repo: AffiliateRepository = {
    upsertOffer: async (row) => { rows.set(row.id, row); },
    getOffer: async (id) => rows.get(id) ?? null,
    getLink: async (id) => links.get(id) ?? null,
    isProgramActive: async () => true,
    addClick: async (row) => { clicks.push(`${row.offerId}:${row.origin}:${row.commissioned}`); }
  };
  const manager = new AffiliateManager(repo);
  const input = [offer("one", 10000), offer("two", 8000)];
  links.set("one", { id: "link-one", offerId: "one", productKey: "B012345678", url: "https://www.amazon.com.br/dp/B012345678?tag=official-20", status: "active", expiresAt: null });
  const prepared = await manager.prepareOffers(input);
  assert.deepEqual(prepared.map((item) => item.packagePriceCents), [10000, 8000]);
  assert.equal((await manager.resolve("one"))?.commissioned, false);
  rows.set("one", { ...rows.get("one")!, source: "amazon" });
  assert.equal((await manager.resolve("one"))?.commissioned, true);
  assert.equal((await manager.resolve("two"))?.commissioned, false);
  links.set("one", { ...links.get("one")!, productKey: "DIFFERENT" });
  assert.equal((await manager.resolve("one"))?.commissioned, false);
  await manager.trackClick("two", "resultados");
  assert.deepEqual(clicks, ["two:resultados:false"]);
});
