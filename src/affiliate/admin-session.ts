import { cookies } from "next/headers";
import { adminConfigured, verifySession } from "./admin-auth";

export async function isAdmin() {
  if (!adminConfigured()) return false;
  return verifySession((await cookies()).get("fraldacerta_admin")?.value, process.env.ADMIN_SESSION_SECRET!);
}

export function isAdminRequest(request: Request) {
  if (!adminConfigured()) return false;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("fraldacerta_admin="))?.slice("fraldacerta_admin=".length);
  return verifySession(cookie, process.env.ADMIN_SESSION_SECRET!);
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
