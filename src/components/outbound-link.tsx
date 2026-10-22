"use client";

import { ArrowUpRight } from "lucide-react";

export function OutboundLink({ href, offerId, origin }: { href: string; offerId: string; origin: string }) {
  function recordClick() {
    const body = JSON.stringify({ offerId, origin });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/out/click", new Blob([body], { type: "application/json" }));
    else void fetch("/api/out/click", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
  }
  return <a className="outbound-button" href={href} onClick={recordClick} rel="noopener" referrerPolicy="origin-when-cross-origin">Ir para a oferta <ArrowUpRight size={18} aria-hidden="true" /></a>;
}
