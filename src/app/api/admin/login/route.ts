import { NextResponse } from "next/server";
import { adminConfigured, issueSession, verifyPassword } from "@/affiliate/admin-auth";
import { sameOrigin } from "@/affiliate/admin-session";
import { createRateLimiter } from "@/services/rate-limit";

export const runtime = "nodejs";
const limiter = createRateLimiter(5, 60_000);
const globalLimiter = createRateLimiter(20, 60_000);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!limiter.allow(client) || !globalLimiter.allow("admin-login")) return new Response("Tente novamente em um minuto.", { status: 429 });
  if (!adminConfigured() || Number(request.headers.get("content-length")) > 2048) return new Response(null, { status: 503 });
  const form = await request.formData();
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 512 || !verifyPassword(password, process.env.ADMIN_PASSWORD_SALT!, process.env.ADMIN_PASSWORD_HASH!)) return NextResponse.redirect(new URL("/admin/login?erro=1", request.url), 303);
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set("fraldacerta_admin", issueSession(process.env.ADMIN_SESSION_SECRET!), { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 12 * 60 * 60 });
  return response;
}
