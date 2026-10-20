import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("expansão rejeita cursor inválido antes de consultar o provedor", async () => {
  const response = await POST(new Request("http://localhost/api/search/more", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cep: "59114250", cepConfirmed: true, size: "G", brand: "Pampers", style: "all", sort: "unit-price", cursor: "invalid" }) }));
  assert.equal(response.status, 400);
});
