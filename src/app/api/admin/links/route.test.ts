import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("admin mutation rejects requests without a valid session", async () => {
  const request = new Request("http://localhost/api/admin/links", { method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" }, body: "action=program-activate&marketplace=amazon" });
  assert.equal((await POST(request)).status, 401);
});
