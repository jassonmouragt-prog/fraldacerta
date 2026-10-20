import type { Offer, SearchFilters } from "@/domain/search";

export interface ConnectorSearchResult {
  offers: Offer[];
  rejected: Record<string, number>;
  receivedCount?: number;
  resolution?: { status: "resolved" | "pending" | "unavailable"; reason?: string; sellerCount?: number };
  progress?: { cursor: string; hasMore: boolean; cached: boolean };
  attemptedTokens?: string[];
  collectedAt?: string;
}

export class MarketplaceUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "MarketplaceUnavailableError"; }
}

/** Implementations normalize external offers into the domain model. */
export interface MarketplaceConnector {
  readonly id: string;
  readonly name?: string;
  search(filters: SearchFilters, signal?: AbortSignal): Promise<ConnectorSearchResult>;
}
