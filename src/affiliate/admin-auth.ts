import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_MS = 12 * 60 * 60_000;

function equalHex(a: string, b: string) {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex"), right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPassword(password: string, saltHex: string, hashHex: string) {
  if (!/^[0-9a-f]{32,}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(hashHex)) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
  return equalHex(derived, hashHex);
}

export function issueSession(secret: string, now = Date.now()) {
  const payload = String(now);
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()) {
  if (!value || secret.length < 32) return false;
  const [payload, signature, extra] = value.split(".");
  if (extra || !/^\d{13}$/.test(payload) || !signature) return false;
  const issued = Number(payload);
  if (issued > now || now - issued > SESSION_MS) return false;
  return equalHex(createHmac("sha256", secret).update(payload).digest("hex"), signature);
}

export function adminConfigured() {
  return !!(process.env.ADMIN_PASSWORD_SALT && process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_SESSION_SECRET && process.env.ADMIN_SESSION_SECRET.length >= 32);
}
