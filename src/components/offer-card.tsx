import Image from "next/image";
import { ArrowUpRight, Package } from "lucide-react";
import type { Offer } from "@/domain/search";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const unitMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function OfferCard({ offer, highlighted = false }: { offer: Offer; highlighted?: boolean }) {
  const delivered = offer.shippingPriceCents === null ? null : offer.packagePriceCents + offer.shippingPriceCents;
  return (
    <article className="offer-card">
      <div className="offer-photo">
        {offer.product.imageUrl ? <Image src={offer.product.imageUrl} alt={`Embalagem de ${offer.product.name}`} fill sizes="(max-width: 640px) 100vw, 180px" className="object-contain" /> : <Package aria-hidden="true" size={36} />}
      </div>
      <div className="offer-details">
        {highlighted && <span className="offer-highlight">Melhor oferta encontrada entre as fontes consultadas</span>}
        <span className="offer-brand">{offer.product.brand} · {offer.origin === "imported" ? "Catálogo importado" : "Preço coletado"}</span>
        <h3>{offer.product.name}</h3>
        <p>{offer.store.name} · {offer.unitCount} fraldas{offer.packageCount > 1 ? ` · ${offer.packageCount} pacotes` : ""}</p>
        <small>{offer.origin === "imported" ? "Coletado em" : "Verificado em"} {dateTime.format(new Date(offer.checkedAt))}</small>
        {offer.outbound?.commissioned && offer.outbound.marketplace === "amazon" && <small>Como participante do Programa de Associados da Amazon, sou remunerado pelas compras qualificadas efetuadas. Os preços e a disponibilidade dos produtos poderão sofrer alterações.</small>}
        {offer.origin === "imported" && !offer.availabilityConfirmed && <small>Disponibilidade não confirmada pelo parceiro.</small>}
      </div>
      <div className="offer-price">
        <strong>{money.format(offer.packagePriceCents / 100)}</strong>
        <span>{unitMoney.format(offer.unitPriceCents / 100)} por fralda</span>
        {offer.source === "amazon" && offer.usedPriceCents !== undefined && <small>Menor preço usado informado pela Amazon: {money.format(offer.usedPriceCents / 100)}</small>}
        {delivered !== null ? <small>Frete cotado: {money.format(offer.shippingPriceCents! / 100)} · Total com frete: {money.format(delivered / 100)}</small> : <small>Frete não verificado</small>}
        <small className={offer.outbound?.commissioned ? "commission-label" : "uncommissioned-label"}>{offer.outbound?.commissioned ? "Link comissionado" : "Link não comissionado"}</small>
        <a href={offer.outbound?.href ?? offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver oferta de ${offer.product.name} em ${offer.store.name}${offer.outbound?.commissioned ? ", link comissionado" : ", link não comissionado"}`}>Ver oferta <ArrowUpRight size={17} aria-hidden="true" /></a>
      </div>
    </article>
  );
}
