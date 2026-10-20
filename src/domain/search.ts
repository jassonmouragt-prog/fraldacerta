export const SIZES = ["RN", "P", "M", "G", "XG", "XXG"] as const;
export const BRANDS = ["Todas as marcas", "Pampers", "Huggies", "MamyPoko", "Babysec", "Personal", "Cremer", "Pom Pom"] as const;

export type DiaperSize = (typeof SIZES)[number];
export type DiaperStyle = "all" | "tape" | "pants";
export type SearchSort = "total-price" | "unit-price" | "delivered-price";

export interface SearchFilters {
  cep: string;
  size: DiaperSize;
  brand: string | null;
  style: DiaperStyle;
  sort: SearchSort;
}

export interface Product {
  id: string;
  brand: string;
  line: string | null;
  name: string;
  size: DiaperSize;
  style: Exclude<DiaperStyle, "all">;
  imageUrl: string | null;
}

export interface Store {
  id: string;
  name: string;
  logoUrl?: string;
}

export interface Offer {
  id: string;
  source: string;
  product: Product;
  store: Store;
  unitCount: number;
  packageCount: number;
  unitsPerPackage: number;
  packagePriceCents: number;
  unitPriceCents: number;
  shippingPriceCents: number | null;
  checkedAt: string;
  url: string;
  origin?: "live" | "imported";
  availabilityConfirmed?: boolean;
  usedPriceCents?: number;
}

export interface SourceStatus {
  id: string;
  name: string;
  status: "success" | "failed" | "unavailable";
  offerCount: number;
  receivedCount?: number;
  rejected: Record<string, number>;
  reason?: string;
  resolution?: { status: "resolved" | "pending" | "unavailable"; reason?: string; sellerCount?: number };
  cached?: boolean;
}

export interface SearchResult {
  filters: SearchFilters;
  offers: Offer[];
  count: number;
  sources: SourceStatus[];
  shipping: { confirmedOfferCount: number; unverifiedOfferCount: number };
  searchedAt: string;
  status: "available" | "unavailable" | "partial";
  progress?: { cursor: string; hasMore: boolean; cached: boolean };
}
