/**
 * Bot Runner — Main trading bot loop
 *
 * FIX LOG:
 *   [Bug #4] Session refresh: ensureSession() is now called proactively at
 *            the start of every scan cycle, not just lazily inside individual
 *            API calls. Prevents stale-token failures between scans.
 *   [Bug #5] monitorPositions() is now called immediately on startBot() and
 *            after every scan, not only inside the interval timer. Previously
 *            closed trades sat undetected for up to 5 minutes after a restart.
 *   [Change] Daily profit target now resets on every manual bot start, not at
 *            midnight UTC. sessionStart = state.startedAt.
 *   [Feature] resetSessionPnl(newStartingValue) lets the dashboard manually
 *             reset the P&L accumulator to 0 or any custom figure mid-session.
 *   [Fix #6] Profit halt includes unrealized P&L from open positions
 *            (position.profit already returned by getPositions() — zero extra
 *            API calls). totalPnl = effectivePnl + unrealizedPnl.
 *   [Fix #7] Real-time P&L monitor runs every 15 s (separate from the 5-min
 *            scan). Checks totalPnl against the profit target on every tick —
 *            closes all positions and stops the bot immediately when crossed.
 *   [Fix #8] sessionStartBalance is captured once when the bot is turned on.
 *            All halt thresholds are computed as:
 *              dollarThreshold = sessionStartBalance × currentSetting%
 *            The dailyProfitTarget percentage is loaded fresh from DB on every
 *            check so dashboard changes take effect immediately — but the BASE
 *            BALANCE never drifts.
 *   [Fix #9] Deal confirmation status check: live Capital.com returns HTTP 200
 *            for position creation but may set status "REJECTED" in the deal
 *            confirmation. The bot now checks status before recording a trade,
 *            preventing ghost positions in the DB.
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";
import { CapitalApiClient, type CapitalCandle } from "./capitalApi";
import { normalizeCapitalUrl, isDemoUrl } from "./capitalUrl";
import { analyzeMarket, getCurrentKillZone } from "./ictStrategy";

// ─────────────────────────────────────────────
// Candle aggregation helpers
// ─────────────────────────────────────────────

/**
 * HTF RESAMPLING FIX
 *
 * OLD behaviour (broken): weekly = every 5 daily bars, monthly = every 21
 * daily bars, counted from the START of the array. Two consequences:
 *   1. Buckets never aligned to real week/month boundaries.
 *   2. Every new daily bar shifted EVERY bucket boundary, so the "Monthly"
 *      and "Weekly" order-flow bias could flip purely because the grouping
 *      moved — not because price did anything. The mandatory HTF gate was
 *      therefore built on a wobbling foundation.
 *   3. The fixed 5-bar week is wrong for crypto, which trades 7 days a week,
 *      so BTC/ETH HTF bias was more corrupted than Gold/FX.
 *
 * NEW behaviour: group by CALENDAR boundary derived from each candle's own
 * snapshotTime (ISO week for weekly, year+month for monthly). Boundaries are
 * stable as new candles arrive, and the logic is instrument-agnostic — a week
 * is a week whether the market trades 5 days or 7.
 *
 * Partial buckets: the most recent week/month is still forming. It is kept
 * (the strategy needs a current bias) but callers should treat the last bar
 * as in-progress.
 */
function groupCandlesByKey(
  daily: CapitalCandle[],
  keyOf: (date: Date) => string,
): CapitalCandle[] {
  // Ensure chronological order — grouping assumes oldest → newest.
  const sorted = [...daily].sort(
    (a, b) => new Date(a.snapshotTime).getTime() - new Date(b.snapshotTime).getTime(),
  );

  const buckets = new Map<string, CapitalCandle[]>();
  const order: string[] = [];

  for (const candle of sorted) {
    const date = new Date(candle.snapshotTime);
    if (Number.isNaN(date.getTime())) continue;
    const key = keyOf(date);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(candle);
  }

  return order.map((key) => {
    const chunk = buckets.get(key)!;
    return {
      snapshotTime: chunk[0].snapshotTime,
      openPrice: chunk[0].openPrice,
      highPrice: {
        bid: Math.max(...chunk.map((c) => c.highPrice.bid)),
        ask: Math.max(...chunk.map((c) => c.highPrice.ask)),
      },
      lowPrice: {
        bid: Math.min(...chunk.map((c) => c.lowPrice.bid)),
        ask: Math.min(...chunk.map((c) => c.lowPrice.ask)),
      },
      closePrice: chunk[chunk.length - 1].closePrice,
      lastTradedVolume: chunk.reduce((s, c) => s + (c.lastTradedVolume ?? 0), 0),
    };
  });
}

/** ISO-8601 week key, e.g. "2026-W31". Weeks start Monday, UTC. */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday of the current ISO week — defines the ISO year.
  const dayNum = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Calendar month key, e.g. "2026-07". */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toWeeklyCandles(daily: CapitalCandle[]): CapitalCandle[] {
  return groupCandlesByKey(daily, isoWeekKey);
}

function toMonthlyCandles(daily: CapitalCandle[]): CapitalCandle[] {
  return groupCandlesByKey(daily, monthKey);
}

import {
  calculateFixedUsdTargets,
  calculateTargetNotionalSize,
  canOpenNewTrade,
  DEFAULT_STOP_LOSS_USD,
  DEFAULT_TAKE_PROFIT_USD,
  DEFAULT_TRADE_LEVERAGE,
  DEFAULT_TRADE_NOTIONAL_USD,
  formatPrice,
  getDecimalPlacesForEpic,
  getMinStopDistance,
} from "./riskManager";
import { logger } from "./logger";

const MARKET_MAP: Record<string, string> = {
  BTCUSD: "Bitcoin",
  ETHUSD: "Ethereum",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCHF: "USD/CHF",
  GOLD: "Gold",
  SILVER: "Silver",
  AUDUSD: "AUD/USD",
};

function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Fixed USD-notional order sizing.
 *
 * Capital.com applies leverage at the account/instrument level; it does not
 * accept a leverage field in POST /positions. These values therefore control
 * the target exposure and the local pre-trade margin check.
 */
const TRADE_LEVERAGE = positiveNumberEnv(
  "TRADE_LEVERAGE",
  DEFAULT_TRADE_LEVERAGE,
);
const TRADE_NOTIONAL_USD = positiveNumberEnv(
  "TRADE_NOTIONAL_USD",
  DEFAULT_TRADE_NOTIONAL_USD,
);
/**
 * Fixed USD exit targets applied to every trade.
 * Defaults: TP $5,530 (31.6 % of the $17,500 margin) and SL $4,655 (26.6 %).
 * Override with TRADE_TAKE_PROFIT_USD / TRADE_STOP_LOSS_USD env vars.
 */
const TRADE_TAKE_PROFIT_USD = positiveNumberEnv(
  "TRADE_TAKE_PROFIT_USD",
  DEFAULT_TAKE_PROFIT_USD,
);
const TRADE_STOP_LOSS_USD = positiveNumberEnv(
  "TRADE_STOP_LOSS_USD",
  DEFAULT_STOP_LOSS_USD,
);

/**
 * SINGLE-MARKET MODE.
 * The bot only ever scans and trades BTCUSD. No other market is scanned.
 */
export const ONLY_MARKET_EPIC = "BTCUSD";

interface BotState {
  running: boolean;
  startedAt: Date | null;
  lastScan: Date | null;
  error: string | null;
  client: CapitalApiClient | null;
  scanInterval: NodeJS.Timeout | null;
  /** Lightweight 15-second interval that checks P&L halt conditions in real time. */
  pnlMonitorInterval: NodeJS.Timeout | null;
  /**
   * P&L offset applied to raw session P&L.
   * effectivePnl = rawSessionPnl - sessionPnlOffset
   *
   * When the user resets to zero:    offset = rawSessionPnl       → effectivePnl = 0
   * When the user resets to $X:      offset = rawSessionPnl - X   → effectivePnl = X
   * Default (bot start):             offset = 0                   → effectivePnl = rawSessionPnl
   */
  sessionPnlOffset: number;
  /**
   * Account balance captured exactly when the bot was turned on.
   * All halt-threshold dollar amounts are computed as:
   *   dollarAmount = sessionStartBalance × currentSetting%
   *
   * This ensures the reference point never drifts during a session even as
   * profits accumulate, while still allowing the dashboard to change the
   * percentage at any time (it is read fresh from DB on every check).
   *
   * Reset to null on stopBot() so the next start always captures a fresh value.
   */
  sessionStartBalance: number | null;
}

const state: BotState = {
  running: false,
  startedAt: null,
  lastScan: null,
  error: null,
  client: null,
  scanInterval: null,
  pnlMonitorInterval: null,
  sessionPnlOffset: 0,
  sessionStartBalance: null,
};

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    error: state.error,
    sessionValid: state.client?.isSessionValid() ?? false,
    sessionPnlOffset: state.sessionPnlOffset,
    sessionStartBalance: state.sessionStartBalance,
  };
}

async function loadSettings() {
  const rows = await db.select().from(botSettingsTable).limit(1);
  let row: typeof botSettingsTable.$inferSelect;
  if (rows.length === 0) {
    const inserted = await db.insert(botSettingsTable).values({}).returning();
    row = inserted[0];
  } else {
    row = rows[0];
  }
  return {
    ...row,
    capitalApiKey:     process.env["CAPITAL_API_KEY"]                                        || row.capitalApiKey,
    capitalIdentifier: process.env["CAPITAL_IDENTIFIER"]                                   || row.capitalIdentifier,
    capitalPassword:   process.env["CAPITAL_PASSWORD"]                                     || row.capitalPassword,
    // FIX (demo login): always run the base URL through the normaliser so a
    // legacy / malformed host in the DB or in Railway env vars can never break
    // the Capital.com session handshake.
    capitalApiUrl:     normalizeCapitalUrl(
      process.env["CAPITAL_API_BASE_URL"] || process.env["CAPITAL_API_URL"] || row.capitalApiUrl,
      row.isDemo,
    ),
  };
}

/**
 * Manually reset the session P&L accumulator.
 *
 * @param newStartingValue - What the effective P&L should read after reset.
 *   Pass 0 (default) to start from scratch.
 *   Pass any positive or negative number to begin from that figure.
 *
 * Can be called while the bot is running — takes effect on the very next scan.
 * Can also be called when the bot is stopped to pre-set an offset for the next session.
 */
export async function resetSessionPnl(newStartingValue: number = 0): Promise<void> {
  const sessionStart = state.startedAt ?? new Date(0); // if bot is stopped, 0 means all-time
  const tradesRows = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.entryDate))
    .limit(100);

  const rawSessionPnl = tradesRows
    .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
    .reduce((sum, t) => sum + (t.profit ?? 0), 0);

  // offset = rawSessionPnl - newStartingValue
  // so that: effectivePnl = rawSessionPnl - offset = newStartingValue
  state.sessionPnlOffset = rawSessionPnl - newStartingValue;

  logger.info(
    { newStartingValue, rawSessionPnl, sessionPnlOffset: state.sessionPnlOffset },
    "Session P&L manually reset"
  );
}

/**
 * Compute the total session P&L (closed + unrealized) against the session-start
 * balance.  This is a pure helper — no side effects, no API calls.
 *
 * @param rawSessionPnl   - Sum of profit on closed trades since sessionStart
 * @param unrealizedPnl   - Sum of position.profit on all currently open positions
 */
function computeTotalPnl(rawSessionPnl: number, unrealizedPnl: number): number {
  const effectivePnl = rawSessionPnl - state.sessionPnlOffset;
  return effectivePnl + unrealizedPnl;
}

async function scanMarkets() {
  if (!state.client) return;

  try {
    await state.client.ensureSession();
  } catch (refreshErr) {
    logger.error({ err: refreshErr }, "Session refresh failed — will retry next scan");
    return;
  }

  const scanStart = new Date().toISOString();
  logger.info({ scanStart }, "=== Market scan starting ===");

  try {
    // Load settings fresh — the profit target percentage may have been updated
    // from the dashboard since the last scan.
    const settings = await loadSettings();
    // SINGLE-MARKET MODE: the bot scans BTCUSD and nothing else. Any other
    // epic stored in settings.enabledMarkets is ignored on purpose.
    const markets = [ONLY_MARKET_EPIC];
    const enabledKillZones = settings.enabledKillZones.split(",").map((k: string) => k.trim()).filter(Boolean);

    const currentKillZone = getCurrentKillZone();
    logger.info(
      { currentKillZone, enabledKillZones, inKillZone: currentKillZone !== null && enabledKillZones.includes(currentKillZone) },
      "Kill zone check"
    );

    let openPositions: Awaited<ReturnType<CapitalApiClient["getPositions"]>>;
    let accounts: Awaited<ReturnType<CapitalApiClient["getAccounts"]>>;

    try {
      [openPositions, accounts] = await Promise.all([
        state.client.getPositions(),
        state.client.getAccounts(),
      ]);
    } catch (apiErr) {
      logger.error({ err: apiErr }, "Capital.com API call failed — will re-authenticate on next scan.");
      await state.client.createSession().catch((e) =>
        logger.error({ err: e }, "Re-authentication failed")
      );
      return;
    }

    const openCount = openPositions.length;
    const account = accounts[0];
    if (!account) {
      logger.error("No account found — check Capital.com credentials and account status");
      return;
    }

    const liveBalance = account.balance.balance;
    const availableBalance = account.balance.available;
    logger.info(
      {
        accountId: account.accountId,
        accountType: account.accountType,
        liveBalance,
        availableBalance,
        openPositions: openCount,
      },
      "Account snapshot"
    );

    // ── Session-based P&L window ──────────────────────────────────────────────
    const sessionStart = state.startedAt ?? new Date();

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const rawSessionPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.position.profit ?? 0), 0);
    const totalPnl = computeTotalPnl(rawSessionPnl, unrealizedPnl);
    // ─────────────────────────────────────────────────────────────────────────

    // ── Halt threshold calculation ────────────────────────────────────────────
    // Use session-start balance as the reference so the bar never drifts.
    // Fall back to live balance only if startBot() somehow didn't capture it.
    const refBalance = state.sessionStartBalance ?? liveBalance;

    // Profit threshold computed from CURRENT settings % × session-start balance.
    // Changing it in the dashboard takes effect on the very next scan.
    const profitTargetAmount = (refBalance * settings.dailyProfitTarget) / 100;
    // ─────────────────────────────────────────────────────────────────────────

    logger.info(
      {
        sessionStartBalance: refBalance,
        profitTargetPct: settings.dailyProfitTarget,
        profitTargetAmount: profitTargetAmount.toFixed(2),
        totalPnl: totalPnl.toFixed(2),
      },
      "Session P&L snapshot"
    );

    // ── Daily profit target halt check ───────────────────────────────────────
    if (settings.haltOnDailyProfit && totalPnl >= profitTargetAmount) {
      logger.info(
        {
          totalPnl: totalPnl.toFixed(2),
          profitTargetAmount: profitTargetAmount.toFixed(2),
          profitTargetPct: settings.dailyProfitTarget,
          sessionStartBalance: refBalance,
        },
        "🎯 Daily profit target reached (closed + unrealized) — closing all positions and halting bot"
      );
      try {
        for (const pos of openPositions) {
          await state.client.closePosition(pos.position.dealId).catch((e) =>
            logger.error({ err: e, dealId: pos.position.dealId }, "Failed to close position during profit halt")
          );
        }
      } catch (closeErr) {
        logger.error({ err: closeErr }, "Error while closing positions during profit halt");
      }
      await stopBot();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const tradeLimitCheck = canOpenNewTrade(openCount, settings.maxOpenTrades);

    if (!tradeLimitCheck.allowed) {
      logger.info({ reason: tradeLimitCheck.reason }, "Trade limit — no new trades will be opened this scan");
    }

    const strategyConfig = {
      useOrderBlocks: settings.useOrderBlocks,
      useFairValueGaps: settings.useFairValueGaps,
      useLiquiditySweeps: settings.useLiquiditySweeps,
      useBOS: settings.useBOS,
      useChoCH: settings.useChoCH,
      minRR: settings.minRR,
      minConfidence: settings.minConfidence,
      enabledKillZones,
    };

    logger.info(
      { markets, minConfidence: settings.minConfidence, minRR: settings.minRR, strategyFeatures: strategyConfig },
      "Scanning markets"
    );

    for (const epic of markets) {
      try {
        logger.info({ epic }, "Fetching candle data…");

        const [
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData,
        ] = await Promise.all([
          state.client.getCandles(epic, "DAY", 200),
          state.client.getCandles(epic, "HOUR_4", 50),
          state.client.getCandles(epic, "HOUR", 100),
          state.client.getCandles(epic, "MINUTE_15", 100),
          state.client.getSingleMarket(epic),
        ]);

        const weeklyCandles = toWeeklyCandles(dailyCandles);
        const monthlyCandles = toMonthlyCandles(dailyCandles);

        if (!marketData) {
          logger.warn({ epic }, "Market data not found — epic may be wrong or market is closed. Skipping.");
          continue;
        }

        logger.info(
          {
            epic,
            marketStatus: marketData.marketStatus,
            bid: marketData.bid,
            offer: marketData.offer,
            daily: dailyCandles.length,
            weekly: weeklyCandles.length,
            monthly: monthlyCandles.length,
            h4: h4Candles.length,
            h1: h1Candles.length,
            m15: m15Candles.length,
          },
          "Candle data fetched — running ICT analysis"
        );

        if (marketData.marketStatus !== "TRADEABLE") {
          logger.info({ epic, marketStatus: marketData.marketStatus }, "Market not tradeable — skipping");
          continue;
        }

        const signal = await analyzeMarket(
          epic,
          MARKET_MAP[epic] ?? epic,
          monthlyCandles,
          weeklyCandles,
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData.bid,
          marketData.offer,
          strategyConfig
        );

        if (!signal) {
          logger.info(
            { epic, minConfidence: settings.minConfidence, minRR: settings.minRR },
            "No signal generated — HTF alignment missing, confidence below threshold, or no entry confluence."
          );
          continue;
        }

        logger.info(
          {
            epic,
            signal: signal.signalType,
            direction: signal.direction,
            confidence: signal.confidence,
            htfBias: signal.htfBias,
            structureContext: signal.structureContext,
            killZone: signal.killZone,
            entry: signal.entryPrice,
            stop: signal.stopLoss,
            target: signal.takeProfit,
          },
          "ICT signal detected"
        );

        const [savedSignal] = await db.insert(signalsTable).values({
          epic,
          market: MARKET_MAP[epic] ?? epic,
          direction: signal.direction,
          signalType: signal.signalType,
          timeframe: signal.timeframe,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          killZone: signal.killZone,
          notes: signal.notes,
          htfBias: signal.htfBias,
          structureContext: signal.structureContext,
          executed: false,
        }).returning();

        if (!tradeLimitCheck.allowed) {
          logger.info({ reason: tradeLimitCheck.reason }, "Signal found but skipping execution — trade limit active");
          continue;
        }

        const minStop = getMinStopDistance(epic, signal.entryPrice);
        const rawStopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

        if (rawStopDistance < minStop) {
          logger.warn(
            { epic, rawStopDistance: rawStopDistance.toFixed(5), minStop: minStop.toFixed(5) },
            "Stop too tight for Capital.com — widening to instrument minimum"
          );
          if (signal.direction === "BUY") {
            signal.stopLoss  = signal.entryPrice - minStop;
            signal.takeProfit = signal.entryPrice + minStop * settings.minRR;
          } else {
            signal.stopLoss  = signal.entryPrice + minStop;
            signal.takeProfit = signal.entryPrice - minStop * settings.minRR;
          }
        }

        // Price the order will actually execute at (ask for BUY, bid for SELL).
        // The strategy's signal.entryPrice is a theoretical level and can be
        // hundreds of dollars away on BTC — anchoring the exits on it is what
        // made the realised TP/SL percentages drift (22 % / 36.1 %).
        const executionPrice =
          signal.direction === "BUY"
            ? (marketData.offer || signal.entryPrice)
            : (marketData.bid || signal.entryPrice);

        const sizeResult = calculateTargetNotionalSize({
          entryPrice: executionPrice,
          epic,
          targetNotionalUsd: TRADE_NOTIONAL_USD,
          leverage: TRADE_LEVERAGE,
          decimalPlaces: getDecimalPlacesForEpic(epic),
        });

        logger.info(
          {
            epic,
            size: sizeResult.size,
            targetNotionalUsd: sizeResult.targetNotionalUsd,
            notionalUsd: sizeResult.notionalUsd,
            leverage: sizeResult.leverage,
            estimatedMarginUsd: sizeResult.estimatedMarginUsd,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
          },
          "Fixed-notional position size calculated"
        );

        if (sizeResult.size <= 0) {
          logger.warn({ epic, sizeResult }, "Calculated size is 0 — skipping.");
          continue;
        }

        // ── Fixed USD take-profit / stop-loss ────────────────────────────
        // Replace the strategy's R-multiple exits with absolute USD targets
        // sized off the actual order size, so every trade risks $4,655 (26.6 %
        // of margin) and targets $5,530 (31.6 % of margin).
        const usdTargets = calculateFixedUsdTargets({
          entryPrice: executionPrice,
          size: sizeResult.size,
          epic,
          direction: signal.direction,
          takeProfitUsd: TRADE_TAKE_PROFIT_USD,
          stopLossUsd: TRADE_STOP_LOSS_USD,
        });
        signal.stopLoss = usdTargets.stopLoss;
        signal.takeProfit = usdTargets.takeProfit;

        logger.info(
          {
            epic,
            size: sizeResult.size,
            entry: executionPrice,
            signalEntry: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            stopDistance: usdTargets.stopDistance,
            targetDistance: usdTargets.targetDistance,
            takeProfitUsd: usdTargets.takeProfitUsd,
            stopLossUsd: usdTargets.stopLossUsd,
            stopWidenedToBrokerMinimum: usdTargets.stopWidened,
            marginUsd: sizeResult.estimatedMarginUsd,
          },
          "Fixed USD exit targets applied (TP 31.6 % / SL 26.6 % of $17,500 margin)",
        );

        if (availableBalance < sizeResult.estimatedMarginUsd) {
          logger.warn(
            {
              epic,
              availableBalance,
              requiredMarginUsd: sizeResult.estimatedMarginUsd,
              targetNotionalUsd: sizeResult.notionalUsd,
              leverage: sizeResult.leverage,
            },
            "Insufficient available balance for target leveraged position — skipping",
          );
          continue;
        }

        try {
          logger.info({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            entry: signal.entryPrice,
            stop: formatPrice(signal.stopLoss, epic),
            target: formatPrice(signal.takeProfit, epic),
          }, "Placing order on Capital.com…");

          const dealResult = await state.client.createPosition({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            stopLevel: formatPrice(signal.stopLoss, epic),
            profitLevel: formatPrice(signal.takeProfit, epic),
          });

          logger.info({ epic, dealReference: dealResult.dealReference }, "Order submitted — waiting for confirmation");

          await new Promise((r) => setTimeout(r, 2000));
          const confirmation = await state.client.getDealConfirmation(dealResult.dealReference);

          logger.info({ epic, dealId: confirmation.dealId, status: confirmation.status }, "Deal confirmation received");

          // FIX #9 (live account): always check the deal status before recording.
          // On live Capital.com the API returns HTTP 200 for the position
          // creation request but then reports status "REJECTED" in the deal
          // confirmation (e.g. STOP_OR_LIMIT_NOT_SATISFIED, INSUFFICIENT_FUNDS,
          // IG_UNIT_SIZE_BELOW_MINIMUM, etc.).  The old code ignored this status,
          // marked the signal as executed, and inserted a trade row for a deal
          // that never actually opened — causing ghost positions in the DB.
          if (confirmation.status !== "ACCEPTED" && confirmation.status !== "OPEN") {
            logger.error(
              { epic, dealReference: dealResult.dealReference, dealId: confirmation.dealId, status: confirmation.status },
              `❌ Deal REJECTED by Capital.com (status: ${confirmation.status}) — trade NOT recorded`
            );
            // Leave the signal as unexecuted so it can be retried next scan.
            continue;
          }

          // ── Re-anchor exits on the ACTUAL fill price / size ──────────────
          // Capital.com fills at the live ask/bid with spread + slippage, so
          // the levels sent with the order can be worth a different USD amount
          // than intended. Recompute from the confirmation and amend the
          // position so TP is exactly $5,530 and SL exactly $4,655.
          const fillPrice =
            Number.isFinite(confirmation.level) && (confirmation.level ?? 0) > 0
              ? (confirmation.level as number)
              : executionPrice;
          const fillSize =
            Number.isFinite(confirmation.size) && (confirmation.size ?? 0) > 0
              ? (confirmation.size as number)
              : sizeResult.size;

          const finalTargets = calculateFixedUsdTargets({
            entryPrice: fillPrice,
            size: fillSize,
            epic,
            direction: signal.direction,
            takeProfitUsd: TRADE_TAKE_PROFIT_USD,
            stopLossUsd: TRADE_STOP_LOSS_USD,
          });
          const finalStop = formatPrice(finalTargets.stopLoss, epic);
          const finalTarget = formatPrice(finalTargets.takeProfit, epic);
          const levelsDrifted =
            Math.abs(finalStop - formatPrice(signal.stopLoss, epic)) > 1e-8 ||
            Math.abs(finalTarget - formatPrice(signal.takeProfit, epic)) > 1e-8;

          if (levelsDrifted) {
            try {
              await state.client.updatePosition(confirmation.dealId, {
                stopLevel: finalStop,
                profitLevel: finalTarget,
              });
              logger.info(
                {
                  epic,
                  dealId: confirmation.dealId,
                  fillPrice,
                  fillSize,
                  stopLevel: finalStop,
                  profitLevel: finalTarget,
                  takeProfitUsd: TRADE_TAKE_PROFIT_USD,
                  stopLossUsd: TRADE_STOP_LOSS_USD,
                  stopWidenedToBrokerMinimum: finalTargets.stopWidened,
                },
                "Exit levels re-anchored on actual fill price",
              );
            } catch (amendErr) {
              const amendMsg =
                amendErr instanceof Error ? amendErr.message : String(amendErr);
              logger.error(
                { epic, dealId: confirmation.dealId, stopLevel: finalStop, profitLevel: finalTarget },
                `Failed to re-anchor exit levels after fill: ${amendMsg}`,
              );
            }
          }

          signal.stopLoss = finalTargets.stopLoss;
          signal.takeProfit = finalTargets.takeProfit;

          await db.update(signalsTable)
            .set({ executed: true })
            .where(eq(signalsTable.id, savedSignal.id));

          await db.insert(tradesTable).values({
            dealId: confirmation.dealId,
            epic,
            market: MARKET_MAP[epic] ?? epic,
            direction: signal.direction,
            size: fillSize,
            entryPrice: fillPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            strategy: `ICT-${signal.signalType}`,
            signalId: savedSignal.id,
            notes: signal.notes,
          });

          logger.info({ epic, dealId: confirmation.dealId, size: sizeResult.size, direction: signal.direction }, "✅ Trade executed successfully");
        } catch (execErr) {
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          logger.error(
            { epic, size: sizeResult.size, direction: signal.direction, stop: formatPrice(signal.stopLoss, epic), target: formatPrice(signal.takeProfit, epic) },
            `❌ Failed to execute trade on ${epic}: ${errMsg}`
          );
        }
      } catch (marketErr) {
        const errMsg = marketErr instanceof Error ? marketErr.message : String(marketErr);
        logger.error({ epic }, `Error scanning market [${epic}]: ${errMsg}`);
      }

      await new Promise((r) => setTimeout(r, 2500));
    }

    state.lastScan = new Date();
    logger.info({ scanEnd: new Date().toISOString(), marketsScanned: markets.length }, "=== Market scan complete ===");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Fatal error during market scan");
    state.error = errMsg;
  }
}

export async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable)
      .where(isNull(tradesTable.result));

    if (openTrades.length > 0) {
      logger.info({ openTrades: openTrades.length }, "Monitoring open positions");
    }

    for (const trade of openTrades) {
      if (!trade.dealId) continue;

      try {
        const positions = await state.client.getPositions();
        const pos = positions.find((p) => p.position.dealId === trade.dealId);

        if (!pos) {
          const market = await state.client.getSingleMarket(trade.epic);
          const exitPrice = market ? (market.bid + market.offer) / 2 : trade.entryPrice;
          const profit = trade.direction === "BUY"
            ? (exitPrice - trade.entryPrice) * trade.size
            : (trade.entryPrice - exitPrice) * trade.size;

          const result = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
          const rr = Math.abs(profit) / (Math.abs(trade.entryPrice - trade.stopLoss) * trade.size);

          await db.update(tradesTable)
            .set({ exitPrice, profit, exitDate: new Date(), result, riskRewardRatio: rr })
            .where(eq(tradesTable.id, trade.id));

          logger.info({ tradeId: trade.id, result, profit: profit.toFixed(4), rr: rr.toFixed(2) }, "Trade closed");
        }
      } catch (err) {
        logger.error({ err, tradeId: trade.id }, "Error monitoring position");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error monitoring positions");
  }
}

/**
 * Real-time P&L halt monitor — runs every 15 seconds.
 *
 * Design:
 *   - sessionStartBalance is captured ONCE in startBot() and never changes
 *     during the session, so the reference point is stable.
 *   - The dailyProfitTarget percentage is loaded FRESH from the DB on every
 *     tick. If you update it in the dashboard while the bot is running, the
 *     new value takes effect within 15 seconds.
 *   - Dollar threshold = sessionStartBalance × currentSetting%
 *   - totalPnl = effectivePnl (closed, session) + unrealizedPnl (open positions)
 *
 * Profit halt: closes ALL open positions then stops the bot.
 * Loss halt  : stops the bot immediately (positions stay open / hit their SL).
 */
async function monitorPnlHalt() {
  if (!state.client || !state.running) return;

  try {
    const [openPositions, accounts] = await Promise.all([
      state.client.getPositions(),
      state.client.getAccounts(),
    ]);

    const account = accounts[0];
    if (!account) return;

    const liveBalance = account.balance.balance;
    const sessionStart = state.startedAt ?? new Date();

    // Load settings fresh so dashboard % changes are picked up within 15 s
    const settings = await loadSettings();

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const rawSessionPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.position.profit ?? 0), 0);
    const totalPnl      = computeTotalPnl(rawSessionPnl, unrealizedPnl);

    // Use session-start balance so the bar doesn't drift as account grows.
    // Fall back to live balance only on the very first tick if capture failed.
    const refBalance = state.sessionStartBalance ?? liveBalance;

    // Profit threshold — recomputed from CURRENT % each tick (dashboard-live)
    const profitTargetAmount = (refBalance * settings.dailyProfitTarget) / 100;

    logger.info(
      {
        refBalance,
        profitTargetPct: settings.dailyProfitTarget,
        profitTargetAmount: profitTargetAmount.toFixed(2),
        totalPnl: totalPnl.toFixed(2),
      },
      "[PnL monitor] tick"
    );

    // ── Profit target halt ────────────────────────────────────────────────────
    if (settings.haltOnDailyProfit && totalPnl >= profitTargetAmount) {
      logger.info(
        {
          totalPnl:           totalPnl.toFixed(2),
          profitTargetAmount: profitTargetAmount.toFixed(2),
          profitTargetPct:    settings.dailyProfitTarget,
          sessionStartBalance: refBalance,
          unrealizedPnl:      unrealizedPnl.toFixed(2),
        },
        "🎯 [Real-time monitor] Daily profit target reached — closing all positions and halting bot"
      );
      // Guard: scan cycle may have already triggered stopBot()
      if (!state.running) return;
      try {
        for (const pos of openPositions) {
          await state.client?.closePosition(pos.position.dealId).catch((e) =>
            logger.error({ err: e, dealId: pos.position.dealId }, "Failed to close position during real-time profit halt")
          );
        }
      } catch (closeErr) {
        logger.error({ err: closeErr }, "Error closing positions during real-time profit halt");
      }
      if (state.running) await stopBot();
      return;
    }

  } catch (err) {
    // Non-fatal — log and wait for the next tick
    logger.error({ err }, "Error in real-time P&L monitor — will retry on next tick");
  }
}

export async function startBot(): Promise<void> {
  if (state.running) throw new Error("Bot is already running");

  const settings = await loadSettings();

  if (!settings.capitalApiKey || !settings.capitalIdentifier || !settings.capitalPassword) {
    throw new Error(
      "Capital.com credentials not configured. " +
      "Please set CAPITAL_API_KEY, CAPITAL_IDENTIFIER, and CAPITAL_PASSWORD " +
      "as environment variables, or save them via the Settings page."
    );
  }

  logger.info(
    {
      url: settings.capitalApiUrl,
      identifier: settings.capitalIdentifier,
      // Report the account type implied by the endpoint we will actually hit
      isDemo: isDemoUrl(settings.capitalApiUrl),
    },
    "Connecting to Capital.com"
  );

  state.client = new CapitalApiClient(
    settings.capitalApiUrl,
    settings.capitalApiKey,
    settings.capitalIdentifier,
    settings.capitalPassword
  );

  await state.client.createSession();

  // ── Capture session-start balance ─────────────────────────────────────────
  // This is the reference point for the session profit target.
  // The percentage is read fresh from settings on every check; only this
  // balance value is locked for the lifetime of the session.
  try {
    const accounts = await state.client.getAccounts();
    const account = accounts[0];
    if (account) {
      state.sessionStartBalance = account.balance.balance;
      const profitTargetAmount = (state.sessionStartBalance * settings.dailyProfitTarget) / 100;
      logger.info(
        {
          sessionStartBalance:  state.sessionStartBalance,
          profitTargetPct:      settings.dailyProfitTarget,
          profitTargetAmount:   profitTargetAmount.toFixed(2),
        },
        "🚀 Session started — balance captured and profit threshold computed"
      );
    } else {
      logger.warn("Could not fetch account balance at startup — will fall back to live balance in halt checks");
      state.sessionStartBalance = null;
    }
  } catch (balanceErr) {
    logger.warn({ err: balanceErr }, "Failed to fetch balance at startup — will fall back to live balance in halt checks");
    state.sessionStartBalance = null;
  }
  // ─────────────────────────────────────────────────────────────────────────

  state.running = true;
  state.startedAt = new Date();
  state.sessionPnlOffset = 0;  // ← reset P&L offset on every manual start
  state.error = null;

  logger.info({ scanIntervalMinutes: 5 }, "Trading bot started — running first scan immediately");

  await scanMarkets();
  await monitorPositions();

  state.scanInterval = setInterval(async () => {
    if (state.running) {
      await scanMarkets();
      await monitorPositions();
    }
  }, 5 * 60 * 1000);

  // Real-time P&L monitor — lightweight, runs every 15 seconds
  state.pnlMonitorInterval = setInterval(async () => {
    if (state.running) {
      await monitorPnlHalt();
    }
  }, 15 * 1000);
}

export async function stopBot(options?: { preserveClient?: boolean }): Promise<void> {
  if (!state.running) throw new Error("Bot is not running");

  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }

  if (state.pnlMonitorInterval) {
    clearInterval(state.pnlMonitorInterval);
    state.pnlMonitorInterval = null;
  }

  if (state.client && !options?.preserveClient) {
    state.client.destroy();
    state.client = null;
  }

  state.running = false;
  state.startedAt = null;
  // Clear the session balance so the next startBot() always captures a fresh snapshot
  state.sessionStartBalance = null;

  logger.info("Trading bot stopped");
}

export function getBotClient(): CapitalApiClient | null {
  return state.client;
}

/** Release the broker client after an operation that needed it while offline. */
export function destroyBotClient(): void {
  state.client?.destroy();
  state.client = null;
}

/** Returns the timestamp when the current (or most recent) session started. */
export function getBotSessionStart(): Date {
  return state.startedAt ?? new Date(0);
}
