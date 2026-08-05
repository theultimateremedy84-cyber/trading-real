import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  console.warn(
    "[db] WARNING: DATABASE_URL is not set. Database operations will fail at runtime. " +
      "Add a PostgreSQL database and set DATABASE_URL.",
  );
}

export const pool = new Pool({
  connectionString: databaseUrl ?? "postgresql://localhost/unconfigured",
});

export const db = drizzle(pool, { schema });

export * from "./schema";

export async function ensureSchema(): Promise<void> {
  if (!databaseUrl) {
    console.warn("[db] Skipping schema bootstrap — DATABASE_URL is not set.");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id                   SERIAL PRIMARY KEY,
        risk_per_trade       REAL    NOT NULL DEFAULT 1.0,
        max_open_trades      INTEGER NOT NULL DEFAULT 3,
        daily_loss_limit     REAL    NOT NULL DEFAULT 3.0,
        daily_profit_target  REAL    NOT NULL DEFAULT 8.0,
        halt_on_daily_profit BOOLEAN NOT NULL DEFAULT true,
        enabled_markets      TEXT    NOT NULL DEFAULT 'BTCUSD,ETHUSD,EURUSD,GBPUSD,USDJPY,USDCHF,GOLD,SILVER,AUDUSD',
        enabled_kill_zones   TEXT    NOT NULL DEFAULT 'LONDON,NEW_YORK',
        min_confidence       REAL    NOT NULL DEFAULT 55.0,
        use_order_blocks     BOOLEAN NOT NULL DEFAULT true,
        use_fair_value_gaps  BOOLEAN NOT NULL DEFAULT true,
        use_liquidity_sweeps BOOLEAN NOT NULL DEFAULT true,
        use_bos              BOOLEAN NOT NULL DEFAULT true,
        use_cho_ch           BOOLEAN NOT NULL DEFAULT true,
        trailing_stop        BOOLEAN NOT NULL DEFAULT false,
        min_rr               REAL    NOT NULL DEFAULT 2.0,
        capital_api_key      TEXT    NOT NULL DEFAULT '',
        capital_password     TEXT    NOT NULL DEFAULT '',
        capital_identifier   TEXT    NOT NULL DEFAULT '',
        capital_api_url      TEXT    NOT NULL DEFAULT 'https://demo-api-capital.backend-capital.com',
        is_demo              BOOLEAN NOT NULL DEFAULT true,
        updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS signals (
        id                SERIAL PRIMARY KEY,
        epic              TEXT    NOT NULL,
        market            TEXT    NOT NULL,
        direction         TEXT    NOT NULL,
        signal_type       TEXT    NOT NULL,
        timeframe         TEXT    NOT NULL,
        entry_price       REAL    NOT NULL,
        stop_loss         REAL    NOT NULL,
        take_profit       REAL    NOT NULL,
        confidence        REAL    NOT NULL,
        detected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        executed          BOOLEAN NOT NULL DEFAULT false,
        kill_zone         TEXT,
        notes             TEXT,
        htf_bias          TEXT,
        structure_context TEXT
      );
      CREATE TABLE IF NOT EXISTS trades (
        id                SERIAL PRIMARY KEY,
        deal_id           TEXT,
        epic              TEXT    NOT NULL,
        market            TEXT    NOT NULL,
        direction         TEXT    NOT NULL,
        size              REAL    NOT NULL,
        entry_price       REAL    NOT NULL,
        exit_price        REAL,
        profit            REAL,
        entry_date        TIMESTAMP NOT NULL DEFAULT NOW(),
        exit_date         TIMESTAMP,
        stop_loss         REAL    NOT NULL,
        take_profit       REAL    NOT NULL,
        strategy          TEXT    NOT NULL DEFAULT 'ICT',
        result            TEXT,
        risk_reward_ratio REAL,
        signal_id         INTEGER,
        notes             TEXT
      );
    `);
    console.log("[db] Schema bootstrap complete — all tables exist.");
  } catch (err) {
    console.error("[db] Schema bootstrap failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
