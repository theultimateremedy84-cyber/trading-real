import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

/**
 * Schema is managed via `drizzle-kit push`. This function is a no-op kept for
 * compatibility with server startup code that calls it before binding.
 */
export async function ensureSchema(): Promise<void> {
  // intentional no-op — schema is pushed via `pnpm --filter @workspace/db run push`
}
