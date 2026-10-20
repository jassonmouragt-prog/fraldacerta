import { z } from "zod";
import { BRANDS, SIZES, type SearchFilters, type SearchResult, type SourceStatus } from "@/domain/search";
import { deduplicateOffers, filterOffers, sortOffers } from "@/domain/comparison";
import { MarketplaceUnavailableError, type MarketplaceConnector } from "@/integrations/marketplace";

export const searchInputSchema = z.strictObject({
  cep: z.string().regex(/^\d{8}$/, "CEP inválido"),
  cepConfirmed: z.literal(true),
  size: z.enum(SIZES),
  brand: z.string().refine((value) => BRANDS.slice(1).some((brand) => brand === value), "Marca inválida").nullable().default(null),
  style: z.enum(["all", "tape", "pants"]).default("all"),
  sort: z.enum(["total-price", "unit-price", "delivered-price"]).default("unit-price")
});

async function runWithTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Tempo limite da fonte excedido.")); }, timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function orchestrateSearch(input: unknown, connectors: MarketplaceConnector[], options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<SearchResult> {
  const parsed = searchInputSchema.parse(input);
  const { cepConfirmed: _confirmed, ...filters } = parsed;
  void _confirmed;
  const searchFilters: SearchFilters = filters;
  const sourceRuns = await Promise.all(connectors.map(async (connector) => {
    try {
      const found = await runWithTimeout((signal) => connector.search(searchFilters, signal), options.timeoutMs ?? 8000, options.signal);
      return { status: { id: connector.id, name: connector.name ?? connector.id, status: "success" as const, offerCount: found.offers.length, receivedCount: found.receivedCount, rejected: found.rejected, resolution: found.resolution, cached: found.progress?.cached }, offers: found.offers, progress: found.progress, collectedAt: found.collectedAt };
    } catch (error) {
      const unavailable = error instanceof MarketplaceUnavailableError;
      const status: SourceStatus = { id: connector.id, name: connector.name ?? connector.id, status: unavailable ? "unavailable" : "failed", offerCount: 0, rejected: {}, reason: unavailable ? error.message : error instanceof Error && error.message === "Tempo limite da fonte excedido." ? error.message : "Falha na consulta da fonte." };
      return { status, offers: [], progress: undefined, collectedAt: undefined };
    }
  }));
  const sources = sourceRuns.map((run) => run.status);
  const offers = sortOffers(deduplicateOffers(filterOffers(sourceRuns.flatMap((run) => run.offers), searchFilters)), searchFilters.sort);
  const succeeded = sources.filter((source) => source.status === "success").length;
  return {
    filters: searchFilters, offers, count: offers.length, sources,
    shipping: { confirmedOfferCount: offers.filter((offer) => offer.shippingPriceCents !== null).length, unverifiedOfferCount: offers.filter((offer) => offer.shippingPriceCents === null).length },
    searchedAt: sourceRuns.find((run) => run.collectedAt)?.collectedAt ?? new Date().toISOString(),
    progress: sourceRuns.find((run) => run.progress)?.progress,
    status: succeeded === 0 ? "unavailable" : succeeded === sources.length ? "available" : "partial"
  };
}
