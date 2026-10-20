import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { normalizeListing, validateOfferUrl } from "@/domain/normalization";
import { BRANDS, SIZES, type SearchFilters } from "@/domain/search";
import { MarketplaceUnavailableError, type ConnectorSearchResult, type MarketplaceConnector } from "./marketplace";

const MAX_FILE_BYTES = 1_000_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const rowSchema = z.strictObject({
  id: z.string().min(1).max(120),
  store: z.string().min(1).max(120),
  product: z.string().min(1).max(300),
  brand: z.enum(BRANDS.slice(1) as [string, ...string[]]),
  size: z.enum(SIZES),
  style: z.enum(["tape", "pants"]),
  quantity: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
  url: z.url(),
  checkedAt: z.iso.datetime({ offset: true }),
  available: z.union([z.literal(true), z.literal(false), z.null()]).default(null),
  shippingPrice: z.union([z.coerce.number().nonnegative(), z.null()]).default(null),
  shippingCep: z.union([z.string().regex(/^\d{8}$/), z.null()]).default(null),
  deliveryConfirmed: z.boolean().default(false)
});

function csvRows(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (quoted && content[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[i + 1] === "\n") i++;
      row.push(field); if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV com aspas incompletas.");
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const [headers, ...records] = rows;
  if (!headers || new Set(headers).size !== headers.length) throw new Error("Cabeçalho CSV inválido.");
  return records.map((record) => {
    if (record.length !== headers.length) throw new Error("Linha CSV inválida.");
    return Object.fromEntries(headers.map((header, index) => [header, record[index]]));
  });
}

function parseCatalog(content: string, extension: string): unknown[] {
  if (extension === ".json") {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("Catálogo JSON deve ser uma lista.");
    return parsed;
  }
  if (extension === ".csv") return csvRows(content).map((row) => ({
    ...row,
    available: row.available === "" ? null : row.available === "true" ? true : row.available === "false" ? false : row.available,
    shippingPrice: row.shippingPrice === "" ? null : row.shippingPrice,
    shippingCep: row.shippingCep || null,
    deliveryConfirmed: row.deliveryConfirmed === "true" ? true : row.deliveryConfirmed === "false" ? false : row.deliveryConfirmed
  }));
  throw new Error("Use um catálogo .json ou .csv.");
}

export function catalogSignature(content: Buffer | string, key: string): string {
  return createHmac("sha256", key).update(content).digest("hex");
}

export class ImportedCatalogAdapter implements MarketplaceConnector {
  readonly id = "catalog-import";
  readonly name = "Catálogo importado";

  constructor(private readonly options: { path?: string; key?: string; partner?: string; allowedHosts?: string[]; now?: () => number } = {}) {}

  async search(filters: SearchFilters): Promise<ConnectorSearchResult> {
    const path = this.options.path ?? process.env.CATALOG_IMPORT_FILE;
    const key = this.options.key ?? process.env.CATALOG_IMPORT_KEY;
    const partner = this.options.partner ?? process.env.CATALOG_PARTNER_NAME;
    const allowedHosts = this.options.allowedHosts ?? process.env.CATALOG_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
    if (!path || !key || !partner || !allowedHosts?.length) throw new MarketplaceUnavailableError("Catálogo de parceiro autorizado não configurado.");
    if (allowedHosts.some((host) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host))) throw new MarketplaceUnavailableError("Domínios permitidos do catálogo inválidos.");
    let content: Buffer, signature: string;
    try {
      [content, signature] = await Promise.all([readFile(path), readFile(`${path}.sig`, "utf8")]);
    } catch { throw new MarketplaceUnavailableError("Arquivo ou assinatura do catálogo indisponível."); }
    if (content.length > MAX_FILE_BYTES) throw new MarketplaceUnavailableError("Catálogo excede o limite de 1 MB.");
    const actual = Buffer.from(catalogSignature(content, key), "hex");
    const expected = /^[a-f0-9]{64}$/i.test(signature.trim()) ? Buffer.from(signature.trim(), "hex") : Buffer.alloc(0);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new MarketplaceUnavailableError("Assinatura do catálogo inválida.");
    let records: unknown[];
    try { records = parseCatalog(content.toString("utf8"), path.toLowerCase().slice(path.lastIndexOf("."))); }
    catch { throw new MarketplaceUnavailableError("Formato do catálogo inválido."); }
    const now = (this.options.now ?? Date.now)();
    const rejected: Record<string, number> = {};
    const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
    const offers = [];
    for (const record of records.slice(0, 500)) {
      const parsed = rowSchema.safeParse(record);
      if (!parsed.success) { reject("invalid-row"); continue; }
      const row = parsed.data;
      const age = now - Date.parse(row.checkedAt);
      if (age < -300_000 || age > MAX_AGE_MS) { reject("stale-row"); continue; }
      if (!validateOfferUrl(row.url, allowedHosts)) { reject("invalid-url"); continue; }
      if (row.available === false) { reject("unavailable-product"); continue; }
      if (row.deliveryConfirmed && (row.shippingCep === null || row.shippingPrice === null)) { reject("invalid-shipping"); continue; }
      const shippingPrice = row.deliveryConfirmed && row.shippingCep === filters.cep ? row.shippingPrice : null;
      const normalized = normalizeListing({ source: this.id, id: `${partner}:${row.id}`, title: row.product, price: row.price, url: row.url, storeName: row.store, checkedAt: row.checkedAt, imageUrl: null, shippingPrice, allowedHosts, origin: "imported", availabilityConfirmed: row.available === true });
      if (!normalized.ok) { reject(normalized.reason); continue; }
      if (normalized.offer.product.brand !== row.brand || normalized.offer.product.size !== row.size || normalized.offer.product.style !== row.style || normalized.offer.unitCount !== row.quantity) { reject("attribute-mismatch"); continue; }
      offers.push(normalized.offer);
    }
    return { offers, rejected };
  }
}
