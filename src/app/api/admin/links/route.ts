import { NextResponse } from "next/server";
import { isAdminRequest, sameOrigin } from "@/affiliate/admin-session";
import { saveManualLink, setLinkStatus, setProgramStatus } from "@/affiliate/repository";
import type { Marketplace } from "@/affiliate/marketplaces";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return new Response(null, { status: 401 });
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4096) return new Response(null, { status: 413 });
  try {
    const form = await request.formData();
    const action = form.get("action");
    const offerId = form.get("offerId");
    if (action === "save" && typeof offerId === "string" && offerId.length <= 160) {
      const url = form.get("url"), expiry = form.get("expiresAt");
      if (typeof url !== "string" || url.length > 2048 || typeof expiry !== "string" || (expiry && Number.isNaN(Date.parse(expiry)))) throw new Error("Dados inválidos.");
      await saveManualLink({ offerId, url, expiresAt: expiry ? new Date(expiry) : null });
    } else if ((action === "activate" || action === "pause") && typeof offerId === "string" && offerId.length <= 160) {
      await setLinkStatus(offerId, action === "activate" ? "active" : "pending");
    } else if ((action === "program-activate" || action === "program-pause") && ["shopee", "amazon", "mercado-livre"].includes(String(form.get("marketplace")))) {
      await setProgramStatus(form.get("marketplace") as Marketplace, action === "program-activate");
    } else throw new Error("Ação inválida.");
    return NextResponse.redirect(new URL("/admin?salvo=1", request.url), 303);
  } catch { return NextResponse.redirect(new URL("/admin?erro=1", request.url), 303); }
}
