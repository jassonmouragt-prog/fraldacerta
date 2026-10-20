import { ZodError } from "zod";
import { ImportedCatalogAdapter } from "@/integrations/imported-catalog";
import { ProgressiveSearchApiAdapter } from "@/services/progressive-search";
import { createRateLimiter } from "@/services/rate-limit";
import { orchestrateSearch } from "@/services/search-server";

export const runtime = "nodejs";

const limiter = createRateLimiter(12, 60_000);
const jsonHeaders = { "Cache-Control": "no-store" };
const catalog = new ImportedCatalogAdapter();
const searchapi = new ProgressiveSearchApiAdapter();

export async function POST(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!limiter.allow(client)) return Response.json({ error: "Muitas buscas em pouco tempo. Aguarde um minuto e tente novamente." }, { status: 429, headers: { ...jsonHeaders, "Retry-After": "60" } });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Envie os filtros em JSON." }, { status: 415, headers: jsonHeaders });
  if (Number(request.headers.get("content-length")) > 2048) return Response.json({ error: "Consulta muito grande." }, { status: 413, headers: jsonHeaders });
  try {
    const body = await request.text();
    if (body.length > 2048) return Response.json({ error: "Consulta muito grande." }, { status: 413, headers: jsonHeaders });
    const input: unknown = JSON.parse(body);
    const result = await orchestrateSearch(input, [searchapi, catalog], { timeoutMs: 45_000, signal: request.signal });
    return Response.json(result, { headers: jsonHeaders });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Filtros inválidos.", details: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) }, { status: 400, headers: jsonHeaders });
    if (error instanceof SyntaxError) return Response.json({ error: "JSON inválido." }, { status: 400, headers: jsonHeaders });
    return Response.json({ error: "Não foi possível processar a busca." }, { status: 500, headers: jsonHeaders });
  }
}
