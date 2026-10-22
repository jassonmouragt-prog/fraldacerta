import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";
import { issueSession, verifyPassword, verifySession } from "./admin-auth";

test("only the configured password can create a time-limited admin session", () => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync("strong-example-password", Buffer.from(salt, "hex"), 64).toString("hex");
  assert.equal(verifyPassword("wrong-password", salt, hash), false);
  assert.equal(verifyPassword("strong-example-password", salt, hash), true);
  const secret = "a-long-independent-session-secret-for-testing";
  const now = Date.parse("2026-10-22T12:00:00Z");
  const session = issueSession(secret, now);
  assert.equal(verifySession(session, secret, now + 60_000), true);
  assert.equal(verifySession(session, "wrong-secret", now + 60_000), false);
  assert.equal(verifySession(session, secret, now + 13 * 60 * 60_000), false);
});
