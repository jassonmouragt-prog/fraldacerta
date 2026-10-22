import { ArrowRight, CircleAlert, Compass, LoaderCircle, Sparkles } from "lucide-react";
import { sortOffers } from "@/domain/comparison";
import type { SearchResult, SearchSort } from "@/domain/search";
import type { CepLocation } from "@/services/cep";
import { OfferCard } from "./offer-card";

interface Props {
  state: "idle" | "loading" | "success" | "error";
  result: SearchResult | null;
  error: string;
  location: CepLocation | null;
  sort: SearchSort;
  onSortChange: (sort: SearchSort) => void;
  onRetry: () => void;
  onMore: () => void;
  moreLoading: boolean;
  moreError: string;
}

const sortLabels: Record<SearchSort, string> = {
  "unit-price": "Menor preço por fralda",
  "total-price": "Menor preço total",
  "delivered-price": "Menor preço entregue"
};

const rejectionLabels: Record<string, string> = {
  "invalid-listing": "anúncio incompleto", "invalid-url": "link inválido", "invalid-price": "preço inválido",
  "unknown-brand": "marca não identificada", "ambiguous-brand": "marca ambígua",
  "missing-size": "tamanho ausente", "ambiguous-size": "tamanho ambíguo", "unsupported-size": "tamanho não aceito",
  "unknown-style": "tipo não identificado", "missing-quantity": "quantidade ausente", "ambiguous-quantity": "quantidade ambígua",
  "filter-mismatch": "fora dos filtros", "price-unavailable": "preço indisponível", "aggregate-product": "produto agregado sem oferta direta"
};

export function SearchResults({ state, result, error, location, sort, onSortChange, onRetry, onMore, moreLoading, moreError }: Props) {
  const visibleOffers = result?.offers ? sortOffers(sort === "delivered-price" ? result.offers.filter((offer) => offer.shippingPriceCents !== null) : result.offers, sort) : [];
  const successSources = result?.sources.filter((source) => source.status === "success") ?? [];
  const unavailableSources = result?.sources.filter((source) => source.status !== "success") ?? [];
  return (
    <section id="resultados" className="results-section" aria-labelledby="results-heading" aria-live="polite">
      <div className="results-header"><h2 id="results-heading">Um jeito mais claro de escolher.</h2><p>Compare ofertas das fontes consultadas e de catálogos autorizados, com o custo por fralda em destaque.</p><p className="affiliate-explainer">Alguns links podem gerar comissão para a FraldaCerta. Isso não altera a ordenação por preço; cada oferta é identificada.</p></div>
      {state === "loading" && <div className="result-state" role="status"><LoaderCircle className="spin" size={30} aria-hidden="true" /><h3>Consultando as fontes…</h3><p>Verificando anúncios, preços e informações de frete para o CEP informado.</p></div>}
      {state === "error" && <div className="result-state" role="alert"><CircleAlert size={30} aria-hidden="true" /><h3>Não foi possível concluir a busca</h3><p>{error}</p><button type="button" className="text-action" onClick={onRetry}>Tentar novamente <ArrowRight size={16} /></button></div>}
      {state === "success" && result && <>
        <div className="source-summary">
          <span>{result.status === "unavailable" ? "Nenhuma fonte pôde ser consultada" : `${result.count} ${result.count === 1 ? "oferta válida encontrada" : "ofertas válidas encontradas"} entre as fontes consultadas`}</span>
          <span>Consulta em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.searchedAt))}</span>
        </div>
        {successSources.length > 0 && <div className="source-notice" role="status"><div>{successSources.map((source) => <p key={source.id}><strong>{source.name}:</strong> {source.id === "catalog-import" ? "catálogo importado com data de coleta" : source.cached ? "preços em cache" : "consulta realizada"} · {source.receivedCount !== undefined ? `${source.receivedCount} produtos recebidos, ` : ""}{source.offerCount} ofertas válidas{Object.keys(source.rejected).length ? `, ${Object.entries(source.rejected).map(([reason, count]) => `${count} descartados: ${rejectionLabels[reason] ?? reason}`).join(", ")}` : ""}.</p>)}</div></div>}
        {successSources.some((source) => source.resolution) && <div className="source-notice" role="status"><div>{successSources.filter((source) => source.resolution).map((source) => <p key={source.id}><strong>Vendedores:</strong> {source.resolution?.status === "resolved" ? `${source.resolution.sellerCount ?? 0} retornados` : source.resolution?.status === "pending" ? "resolução pendente" : `consulta indisponível. ${source.resolution?.reason ?? ""}`}</p>)}</div></div>}
        {unavailableSources.length > 0 && <div className="source-notice" role="status"><CircleAlert size={18} aria-hidden="true" /><div>{unavailableSources.map((source) => <p key={source.id}><strong>{source.name} indisponível:</strong> {source.reason ?? "Não foi possível consultar esta fonte."}</p>)}</div></div>}
        {result.count > 0 && <div className="results-toolbar"><label htmlFor="result-sort">Ordenar por</label><select id="result-sort" value={sort} onChange={(event) => onSortChange(event.target.value as SearchSort)}>{(Object.keys(sortLabels) as SearchSort[]).map((key) => <option key={key} value={key} disabled={key === "delivered-price" && result.shipping.confirmedOfferCount === 0}>{sortLabels[key]}</option>)}</select></div>}
        {result.count > 0 && visibleOffers.length > 0 && <><p className="ranking-note">{sort === "delivered-price" ? `${visibleOffers.length} ofertas com frete confirmado para o CEP. Ofertas sem cotação não entram nesta ordenação.` : "Melhor oferta encontrada entre as fontes consultadas para esta ordenação."}</p><div className="offer-list">{visibleOffers.map((offer, index) => <OfferCard key={offer.id} offer={offer} highlighted={index === 0} />)}</div></>}
        {result.progress?.hasMore && <div className="result-state"><button type="button" className="text-action" onClick={onMore} disabled={moreLoading}>{moreLoading ? "Buscando mais ofertas…" : "Buscar mais ofertas"} <ArrowRight size={16} /></button>{moreError && <p role="alert">{moreError}</p>}</div>}
        {result.progress && !result.progress.hasMore && <p className="ranking-note">Não há mais produtos elegíveis para esta pesquisa ou o orçamento de consultas foi atingido.</p>}
        {result.status === "unavailable" && <div className="result-state result-state-mint"><Sparkles size={31} aria-hidden="true" /><h3>Fontes de preços indisponíveis</h3><p>{unavailableSources.find((source) => source.id === "google-shopping")?.reason ?? "Nenhuma fonte pôde ser consultada agora. Veja os motivos acima."}</p>{location && <span className="result-location">Busca em {location.city}, {location.state} · CEP {location.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}</span>}</div>}
        {result.status !== "unavailable" && result.count === 0 && <div className="result-state"><Compass size={30} aria-hidden="true" /><h3>Nenhuma oferta compatível encontrada</h3><p>{successSources.some((source) => (source.receivedCount ?? 0) > 0 && Object.values(source.rejected).some(Boolean)) ? "Produtos recebidos foram descartados na validação. Veja os motivos por fonte acima." : "Nenhum produto compatível foi encontrado nas fontes consultadas."}</p></div>}
      </>}
      {state === "idle" && <div className="result-state result-state-idle"><Compass size={31} aria-hidden="true" /><h3>Comece pela sua região</h3><p>Confirme o CEP e escolha o tamanho para preparar sua busca.</p></div>}
    </section>
  );
}
