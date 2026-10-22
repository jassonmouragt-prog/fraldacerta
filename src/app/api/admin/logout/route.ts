import { NextResponse } from "next/server";
import { sameOrigin } from "@/affiliate/admin-session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.delete("fraldacerta_admin");
  return response;
}
