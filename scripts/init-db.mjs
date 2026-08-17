/**
 * Idempotent database migration for the Capital.com ICT trading bot.
 *
 * Runs on every boot (see scripts/start.sh). It is safe to re-run: every
 * statement is CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 *
 * This replaces the old `drizzle-kit push` startup step, which silently failed
 * to migrate deployments that still had the legacy Bybit-era `bot_settings`
 * table (missing capital_* / daily_profit_target columns). That mismatch made
 * every settings + bot query return 500, so the bot could never log in to
 * Capital.com.
 */
import pg from "pg";
const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set — cannot migrate schema.");
  process.exit(1);
}

const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
const pool = new Pool({
  connectionString: url,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});

const DEMO_URL = "https://demo-api-capital.backend-capital.com";

async function q(sql) {
  await pool.query(sql);
}

try {
  // ── bot_settings ───────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      id SERIAL PRIMARY KEY,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Add every column the current Drizzle schema expects. ADD COLUMN IF NOT
  // EXISTS makes this work for both fresh databases and legacy (Bybit) ones.
  const columns = [
    ["risk_per_trade", "REAL NOT NULL DEFAULT 1.0"],
    ["max_open_trades", "INTEGER NOT NULL DEFAULT 3"],
    ["daily_loss_limit", "REAL NOT NULL DEFAULT 3.0"],
    ["daily_profit_target", "REAL NOT NULL DEFAULT 8.0"],
    ["halt_on_daily_profit", "BOOLEAN NOT NULL DEFAULT TRUE"],
    [
      "enabled_markets",
      "TEXT NOT NULL DEFAULT 'BTCUSD'",
    ],
    ["enabled_kill_zones", "TEXT NOT NULL DEFAULT 'LONDON,NEW_YORK'"],
    ["min_confidence", "REAL NOT NULL DEFAULT 55.0"],
    ["use_order_blocks", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["use_fair_value_gaps", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["use_liquidity_sweeps", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["use_bos", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["use_cho_ch", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["trailing_stop", "BOOLEAN NOT NULL DEFAULT FALSE"],
    ["min_rr", "REAL NOT NULL DEFAULT 2.0"],
    ["capital_api_key", "TEXT NOT NULL DEFAULT ''"],
    ["capital_password", "TEXT NOT NULL DEFAULT ''"],
    ["capital_identifier", "TEXT NOT NULL DEFAULT ''"],
    ["capital_api_url", `TEXT NOT NULL DEFAULT '${DEMO_URL}'`],
    ["is_demo", "BOOLEAN NOT NULL DEFAULT TRUE"],
    ["updated_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
  ];

  for (const [name, def] of columns) {
    await q(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS ${name} ${def};`);
  }

  // Legacy Bybit columns are no longer in the schema. Drop their NOT NULL
  // constraints so inserts from the current code never fail on them.
  const legacy = ["bybit_api_key", "bybit_api_secret", "bybit_testnet", "bybit_demo"];
  for (const name of legacy) {
    await q(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'bot_settings' AND column_name = '${name}'
        ) THEN
          EXECUTE 'ALTER TABLE bot_settings ALTER COLUMN ${name} DROP NOT NULL';
        END IF;
      END $$;
    `);
  }

  // Repair rows saved with the old (incorrect) demo host.
  await q(`
    UPDATE bot_settings
    SET capital_api_url = '${DEMO_URL}'
    WHERE capital_api_url LIKE '%demo-api-capital.backend.gb.capital.com%';
  `);

  // SINGLE-MARKET MODE: force every existing row to BTCUSD only.
  await q(`UPDATE bot_settings SET enabled_markets = 'BTCUSD' WHERE enabled_markets <> 'BTCUSD';`);

  // Guarantee exactly one settings row exists so GET /api/settings never has
  // to insert on a cold database.
  await q(`
    INSERT INTO bot_settings (id) SELECT 1
    WHERE NOT EXISTS (SELECT 1 FROM bot_settings);
  `);
  console.log("  ✓ bot_settings");

  // ── signals ───────────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS signals (
      id                SERIAL    PRIMARY KEY,
      epic              TEXT      NOT NULL,
      market            TEXT      NOT NULL,
      direction         TEXT      NOT NULL,
      signal_type       TEXT      NOT NULL,
      timeframe         TEXT      NOT NULL,
      entry_price       REAL      NOT NULL,
      stop_loss         REAL      NOT NULL,
      take_profit       REAL      NOT NULL,
      confidence        REAL      NOT NULL,
      detected_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      executed          BOOLEAN   NOT NULL DEFAULT FALSE,
      kill_zone         TEXT,
      notes             TEXT,
      htf_bias          TEXT,
      structure_context TEXT
    );
  `);
  for (const [name, def] of [
    ["kill_zone", "TEXT"],
    ["notes", "TEXT"],
    ["htf_bias", "TEXT"],
    ["structure_context", "TEXT"],
  ]) {
    await q(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS ${name} ${def};`);
  }
  console.log("  ✓ signals");

  // ── trades ────────────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS trades (
      id                SERIAL    PRIMARY KEY,
      deal_id           TEXT,
      epic              TEXT      NOT NULL,
      market            TEXT      NOT NULL,
      direction         TEXT      NOT NULL,
      size              REAL      NOT NULL,
      entry_price       REAL      NOT NULL,
      exit_price        REAL,
      profit            REAL,
      entry_date        TIMESTAMP NOT NULL DEFAULT NOW(),
      exit_date         TIMESTAMP,
      stop_loss         REAL      NOT NULL,
      take_profit       REAL      NOT NULL,
      strategy          TEXT      NOT NULL DEFAULT 'ICT',
      result            TEXT,
      risk_reward_ratio REAL,
      signal_id         INTEGER,
      notes             TEXT
    );
  `);
  for (const [name, def] of [
    ["deal_id", "TEXT"],
    ["exit_price", "REAL"],
    ["profit", "REAL"],
    ["exit_date", "TIMESTAMP"],
    ["strategy", "TEXT NOT NULL DEFAULT 'ICT'"],
    ["result", "TEXT"],
    ["risk_reward_ratio", "REAL"],
    ["signal_id", "INTEGER"],
    ["notes", "TEXT"],
  ]) {
    await q(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS ${name} ${def};`);
  }
  console.log("  ✓ trades");

  // Fail loudly if the migration somehow left the schema incomplete, instead of
  // letting the server boot and 500 on every request.
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'bot_settings';
  `);
  const present = new Set(rows.map((r) => r.column_name));
  const missing = columns.map(([n]) => n).filter((n) => !present.has(n));
  if (missing.length > 0) {
    console.error("ERROR: bot_settings is still missing columns:", missing.join(", "));
    process.exit(1);
  }

  console.log("Database schema is up to date (Capital.com schema verified).");
} catch (err) {
  console.error("ERROR initialising schema:", err);
  process.exit(1);
} finally {
  await pool.end();
}
