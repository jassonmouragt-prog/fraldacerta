import assert from "node:assert/strict";
import test from "node:test";
import { searchOffers } from "./search";
import type { SearchFilters } from "../domain/search";

const filters: SearchFilters = { cep: "59114250", size: "G", brand: "Pampers", style: "all", sort: "unit-price" };

test("busca propaga cancelamento do cliente ao POST", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true }));
  };
  try {
    const request = searchOffers(filters, controller.signal);
    controller.abort();
    await assert.rejects(request);
    assert.equal(receivedSignal?.aborted, true);
  } finally { globalThis.fetch = previousFetch; }
});
