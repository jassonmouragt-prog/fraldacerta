import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

let connection: ReturnType<typeof drizzle> | null = null;

export function affiliateDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!connection) connection = drizzle(neon(url));
  return connection;
}
