import { z, ZodError } from "zod";
import { ImportedCatalogAdapter } from "@/integrations/imported-catalog";
import { createRateLimiter } from "@/services/rate-limit";
import { ProgressiveSearchApiAdapter } from "@/services/progressive-search";
import { orchestrateSearch } from "@/services/search-server";

export const runtime = "nodejs";

const limiter = createRateLimiter(12, 60_000);
const searchapi = new ProgressiveSearchApiAdapter();
const catalog = new ImportedCatalogAdapter();
const headers = { "Cache-Control": "no-store" };
const bodySchema = z.strictObject({
  cep: z.string().regex(/^\d{8}$/), cepConfirmed: z.literal(true), size: z.enum(["RN", "P", "M", "G", "XG", "XXG"]),
  brand: z.string().nullable(), style: z.enum(["all", "tape", "pants"]), sort: z.enum(["total-price", "unit-price", "delivered-price"]),
  cursor: z.string().regex(/^[a-f0-9]{64}$/)
});

export async function POST(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!limiter.allow(client)) return Response.json({ error: "Muitas buscas em pouco tempo. Aguarde um minuto." }, { status: 429, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Envie os filtros em JSON." }, { status: 415, headers });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: "Consulta muito grande." }, { status: 413, headers });
    const { cursor, ...input } = bodySchema.parse(JSON.parse(raw));
    const result = await orchestrateSearch(input, [{ id: searchapi.id, name: searchapi.name, search: (filters, signal) => searchapi.expand(filters, cursor, signal) }, catalog], { timeoutMs: 45_000, signal: request.signal });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Identificador ou filtros inválidos." }, { status: 400, headers });
    return Response.json({ error: "Não foi possível ampliar a busca." }, { status: 500, headers });
  }
}
