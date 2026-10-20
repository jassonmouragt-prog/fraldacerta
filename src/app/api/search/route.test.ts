import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

function request(body: unknown, ip: string) {
  return new Request("http://localhost/api/search", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
}

test("API rejeita CEP não confirmado e tamanho inválido", async () => {
  const response = await POST(request({ cep: "01001000", cepConfirmed: false, size: "GG" }, "test-invalid"));
  assert.equal(response.status, 400);
});

test("API sem token informa fonte indisponível e não inventa ofertas", async () => {
  const response = await POST(request({ cep: "01001000", cepConfirmed: true, size: "G" }, "test-unavailable"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.count, 0);
  assert.equal(result.sources[0].id, "google-shopping");
  assert.equal(result.sources[0].status, "unavailable");
  assert.match(result.sources[0].reason, /SearchAPI.io/);
  assert.equal(result.sources.some((source: { id: string }) => ["amazon", "mercado-livre"].includes(source.id)), false);
  assert.deepEqual(result.offers, []);
});

test("API sem cache compartilhado bloqueia consultas externas", async () => {
  const previousKey = process.env.SEARCHAPI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SEARCHAPI_API_KEY = "invalid-test-key";
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => { if (String(input).startsWith("https://www.searchapi.io/api/v1/search")) providerCalls++; return previousFetch(input, init); };
  try {
    const response = await POST(request({ cep: "59114250", cepConfirmed: true, size: "G", brand: "Pampers" }, "test-searchapi-auth"));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.count, 0);
    const source = result.sources.find((item: { id: string }) => item.id === "google-shopping");
    assert.equal(source.status, "unavailable");
    assert.match(source.reason, /Cache compartilhado/);
    assert.equal(providerCalls, 0);
    assert.equal(JSON.stringify(result).includes("invalid-test-key"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SEARCHAPI_API_KEY;
    else process.env.SEARCHAPI_API_KEY = previousKey;
  }
});
