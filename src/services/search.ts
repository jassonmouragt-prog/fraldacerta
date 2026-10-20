import type { SearchFilters, SearchResult } from "@/domain/search";

export async function searchOffers(filters: SearchFilters, externalSignal?: AbortSignal): Promise<SearchResult> {
  return postSearch("/api/search", filters, externalSignal);
}

export async function searchMoreOffers(filters: SearchFilters, cursor: string, externalSignal?: AbortSignal): Promise<SearchResult> {
  return postSearch("/api/search/more", { ...filters, cursor }, externalSignal);
}

async function postSearch(path: string, filters: SearchFilters | (SearchFilters & { cursor: string }), externalSignal?: AbortSignal): Promise<SearchResult> {
  const deadline = AbortSignal.timeout(50_000);
  const signal = externalSignal ? AbortSignal.any([externalSignal, deadline]) : deadline;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...filters, cepConfirmed: true }),
    cache: "no-store",
    signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Não foi possível consultar as fontes. Tente novamente.");
  }
  return response.json() as Promise<SearchResult>;
}
