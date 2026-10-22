import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";
import { isAdminRequest } from "@/affiliate/admin-session";
import { POST as mutate } from "../links/route";
import { POST as login } from "./route";

test("admin login creates a secure session and mutations enforce session plus CSRF", async () => {
  const previous = Object.fromEntries(["ADMIN_PASSWORD_SALT", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"].map((name) => [name, process.env[name]]));
  const salt = randomBytes(16).toString("hex");
  const password = "local-test-password-only";
  process.env.ADMIN_PASSWORD_SALT = salt;
  process.env.ADMIN_PASSWORD_HASH = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
  try {
    const url = "https://fraldacerta.test/api/admin/login";
    const body = new URLSearchParams({ password });
    const wrongOrigin = await login(new Request(url, { method: "POST", headers: { origin: "https://evil.test" }, body }));
    assert.equal(wrongOrigin.status, 403);
    const response = await login(new Request(url, { method: "POST", headers: { origin: "https://fraldacerta.test" }, body }));
    assert.equal(response.status, 303);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Secure/i);
    const cookie = setCookie.split(";")[0];
    const authorized = new Request("https://fraldacerta.test/api/admin/links", { method: "POST", headers: { cookie, origin: "https://fraldacerta.test" }, body: new URLSearchParams({ action: "invalid" }) });
    assert.equal(isAdminRequest(authorized), true);
    assert.equal((await mutate(new Request(authorized.url, { method: "POST", headers: { cookie, origin: "https://evil.test" }, body: new URLSearchParams({ action: "invalid" }) }))).status, 403);
    assert.equal((await mutate(new Request(authorized.url, { method: "POST", headers: { origin: "https://fraldacerta.test" }, body: new URLSearchParams({ action: "invalid" }) }))).status, 401);
  } finally {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
