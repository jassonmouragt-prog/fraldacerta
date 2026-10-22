import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { affiliateManager } from "@/affiliate/repository";
import { OutboundLink } from "@/components/outbound-link";

export const dynamic = "force-dynamic";

export default async function ExitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ origem?: string }> }) {
  const { id } = await params;
  const manager = affiliateManager();
  const resolved = id.length <= 160 ? await manager?.resolve(id) : null;
  if (!resolved) notFound();
  const origin = (await searchParams).origem === "resultados" ? "resultados" : "direto";
  const host = new URL(resolved.url).hostname;
  return <main className="outbound-page">
    <div className="outbound-card">
      <Link className="outbound-back" href="/#resultados"><ArrowLeft size={17} aria-hidden="true" /> Voltar à comparação</Link>
      <span className="outbound-icon"><ShieldCheck size={27} aria-hidden="true" /></span>
      <h1>Você está saindo da FraldaCerta</h1>
      <p className="outbound-intro">Confira o destino antes de continuar. O preço e a disponibilidade podem mudar na loja.</p>
      <div className="outbound-summary"><strong>{resolved.offer.name}</strong><span>{resolved.offer.storeName}</span><small>Destino: {host}</small></div>
      <p className="outbound-disclosure">{resolved.commissioned ? "Este é um link comissionado. A FraldaCerta pode receber uma comissão por compras qualificadas, sem alterar a ordem das ofertas." : "Este link não é comissionado. Você acessará a oferta original."}</p>
      {resolved.commissioned && resolved.offer.marketplace === "amazon" && <p className="outbound-amazon">Como participante do Programa de Associados da Amazon, sou remunerado pelas compras qualificadas efetuadas.</p>}
      <OutboundLink href={resolved.url} offerId={resolved.offer.id} origin={origin} />
    </div>
  </main>;
}
