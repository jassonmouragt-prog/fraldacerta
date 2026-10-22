import type { SearchResult } from "@/domain/search";
import { affiliateManager } from "./repository";

export async function enrichSearchResult(result: SearchResult): Promise<SearchResult> {
  const manager = affiliateManager();
  if (!manager || result.offers.length === 0) return result;
  try { return { ...result, offers: await manager.prepareOffers(result.offers) }; }
  catch { return result; }
}
