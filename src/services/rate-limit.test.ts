import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "./rate-limit";

test("limita consultas por cliente em janela móvel", () => {
  const limiter = createRateLimiter(2, 1000);
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 100), true);
  assert.equal(limiter.allow("a", 200), false);
  assert.equal(limiter.allow("b", 200), true);
  assert.equal(limiter.allow("a", 1001), true);
});
