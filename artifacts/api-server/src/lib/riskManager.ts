/**
 * Risk Management Module
 * - Position sizing based on a configured USD notional and leverage
 * - Legacy stop-distance risk sizing helper (kept for compatibility)
 * - Max open trades enforcement
 */

export const DEFAULT_TRADE_LEVERAGE = 20;
export const DEFAULT_TRADE_NOTIONAL_USD = 350_000;
export const DEFAULT_TRADE_MARGIN_USD =
  DEFAULT_TRADE_NOTIONAL_USD / DEFAULT_TRADE_LEVERAGE;

export interface RiskParams {
  accountBalance: number;
  riskPerTrade: number; // percentage, e.g. 1.0 = 1%
  entryPrice: number;
  stopLoss: number;
  epic: string;
  minSize?: number;
  maxSize?: number;
  decimalPlaces?: number;
}

export interface SizeResult {
  size: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
}

export interface TargetNotionalParams {
  entryPrice: number;
  epic: string;
  targetNotionalUsd?: number;
  leverage?: number;
  decimalPlaces?: number;
}

export interface TargetNotionalResult {
  /** Raw Capital.com units: coins, ounces, or base-currency units. */
  size: number;
  targetNotionalUsd: number;
  notionalUsd: number;
  leverage: number;
  estimatedMarginUsd: number;
}

/**
 * Returns the contract multiplier for each instrument.
 *
 * Capital.com live API "size" parameter = number of UNITS (not lots).
 *
 *   Forex (EURUSD etc.) : size = units of base currency (e.g. 10,000 = 0.1 lot)
 *   Gold  (GOLD/XAUUSD) : size = oz (1 unit = 1 oz)   ← verified live Jul 2026
 *   Silver (SILVER/XAG) : size = oz (1 unit = 1 oz)
 *   BTC / ETH           : size = coins (1 unit = 1 coin)
 *
 * Formula: size_units = riskAmount / stopDistance
 *   (multiplier = 1 for all instruments; conversion is handled by minSize/maxSize
 *    which are expressed in the same unit the API expects)
 *
 * FIX (live account Aug 2026): original forex multiplier was 100,000 (treating
 * size as lots). Live Capital.com rejects forex orders with
 * error.invalid.size.minvalue when size=0.11 lots is sent, because the API
 * expects units (e.g. 11,000), not lots. GOLD/BTC/ETH are unaffected — their
 * multiplier was already 1. Verified: GOLD size=0.1 oz works on live.
 */
function getContractMultiplier(_epic: string): number {
  // Capital.com expects raw units for ALL instruments.
  // The unit definition differs per instrument (oz for metals, coins for crypto,
  // base-currency units for forex) but the API always wants the raw count.
  return 1;
}

/**
 * Calculate position size in lots based on risk percentage.
 * The `epic` field is required so the correct contract multiplier is applied.
 */
export function calculatePositionSize(params: RiskParams): SizeResult {
  const {
    accountBalance,
    riskPerTrade,
    entryPrice,
    stopLoss,
    epic,
    minSize = 0.01,
    maxSize = 100,
    decimalPlaces = 2,
  } = params;

  const riskAmount = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }

  const multiplier = getContractMultiplier(epic);

  // size (lots) = riskAmount / (stopDistance × contractMultiplier)
  let size = riskAmount / (stopDistance * multiplier);

  // Round down to specified decimal places
  const factor = Math.pow(10, decimalPlaces);
  size = Math.floor(size * factor) / factor;

  // Clamp between min and max
  size = Math.max(minSize, Math.min(maxSize, size));

  return {
    size,
    riskAmount,
    riskPercent: riskPerTrade,
    stopDistance,
  };
}

/**
 * Convert a Capital.com order size into approximate USD notional.
 *
 * Capital.com receives raw units:
 * - USD-base FX pairs (USDJPY, USDCHF): one unit is one USD of notional.
 * - USD-quote FX pairs and crypto: units × entry price.
 * - Gold and silver: ounces × entry price.
 *
 * The bot only trades the instruments listed in MARKET_MAP. The fallback is
 * intentionally the USD-quote calculation so an unknown USD-quoted instrument
 * cannot silently produce a zero notional.
 */
export function calculateUsdNotional(
  size: number,
  entryPrice: number,
  epic: string,
): number {
  const normalizedEpic = epic.toUpperCase();
  const isUsdBaseForex =
    normalizedEpic.startsWith("USD") &&
    !normalizedEpic.includes("BTC") &&
    !normalizedEpic.includes("ETH");

  return isUsdBaseForex ? size : size * entryPrice;
}

/**
 * Calculate the Capital.com raw order size needed for a USD-notional target.
 *
 * Capital.com does not accept leverage as an order parameter. Leverage is
 * applied by the broker/account, so this function records the requested
 * leverage and calculates the expected margin for pre-trade validation.
 */
export function calculateTargetNotionalSize(
  params: TargetNotionalParams,
): TargetNotionalResult {
  const {
    entryPrice,
    epic,
    targetNotionalUsd = DEFAULT_TRADE_NOTIONAL_USD,
    leverage = DEFAULT_TRADE_LEVERAGE,
    decimalPlaces = 0,
  } = params;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`Invalid entry price for ${epic}: ${entryPrice}`);
  }
  if (!Number.isFinite(targetNotionalUsd) || targetNotionalUsd <= 0) {
    throw new Error(`Invalid target notional: ${targetNotionalUsd}`);
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error(`Invalid leverage: ${leverage}`);
  }

  const normalizedEpic = epic.toUpperCase();
  const isUsdBaseForex =
    normalizedEpic.startsWith("USD") &&
    !normalizedEpic.includes("BTC") &&
    !normalizedEpic.includes("ETH");
  const rawSize = isUsdBaseForex
    ? targetNotionalUsd
    : targetNotionalUsd / entryPrice;

  const factor = Math.pow(10, decimalPlaces);
  const size = Math.floor(rawSize * factor) / factor;
  const notionalUsd = calculateUsdNotional(size, entryPrice, epic);

  return {
    size,
    targetNotionalUsd,
    notionalUsd,
    leverage,
    estimatedMarginUsd: notionalUsd / leverage,
  };
}

export function canOpenNewTrade(
  openPositionsCount: number,
  maxOpenTrades: number,
): { allowed: boolean; reason?: string } {
  if (openPositionsCount >= maxOpenTrades) {
    return {
      allowed: false,
      reason: `Max open trades (${maxOpenTrades}) reached`,
    };
  }

  return { allowed: true };
}

/**
 * Format a price to the correct decimal places for a given instrument.
 */
export function formatPrice(price: number, epic: string): number {
  if (epic.includes("BTC") || epic.includes("ETH")) return Math.round(price * 100) / 100;
  if (epic.includes("JPY")) return Math.round(price * 100) / 100;
  if (epic === "GOLD" || epic === "SILVER" || epic.includes("XAU") || epic.includes("XAG")) return Math.round(price * 100) / 100;
  return Math.round(price * 10_000) / 10_000; // 4 decimal places for FX
}

export function getMinSizeForEpic(epic: string): number {
  if (epic.includes("BTC")) return 0.0001;
  if (epic.includes("ETH")) return 0.001;
  if (epic === "GOLD" || epic.includes("XAU")) return 0.1;
  if (epic === "SILVER" || epic.includes("XAG")) return 1;
  // FIX (live Aug 2026): forex size is in units on Capital.com live API.
  // Minimum is 1,000 units (0.01 standard lots). Sending lots (e.g. 0.11)
  // caused error.invalid.size.minvalue — now we send units (e.g. 11,000).
  return 1000; // forex minimum = 1,000 units = 0.01 standard lots
}

export function getDecimalPlacesForEpic(epic: string): number {
  if (epic.includes("BTC")) return 4;
  if (epic.includes("ETH")) return 3;
  if (epic === "GOLD" || epic.includes("XAU") || epic === "SILVER" || epic.includes("XAG")) return 1;
  return 0; // forex: whole units only (1,000; 2,000; etc.)
}

/**
 * Minimum stop distance for each instrument.
 * Capital.com live accounts enforce stricter minimum stop distances than demo.
 * Values here are calibrated for live — they are safe on demo too (just a
 * slightly wider stop, which is preferable to a rejected order).
 *
 *   BTC  0.50 % → ~$320 at $64k    (live minimum ~0.3 %; using 0.5 % for safety)
 *   ETH  0.50 % → ~$9.4 at $1 880  (live minimum ~0.3 %; using 0.5 % for safety)
 *   Gold 0.30 % → ~$5.7 at $1 900  (live minimum ~0.2 %; using 0.3 % for safety)
 *   FX   0.10 % → ~10 pips EURUSD  (live minimum is typically 10 pips, not 5)
 *
 * FIX (live account): original values (BTC/ETH 0.3 %, Gold 0.2 %, FX 0.05 %)
 * were derived from demo API behaviour and are too tight for live accounts.
 * Live Capital.com rejects orders with STOP_OR_LIMIT_NOT_SATISFIED when the
 * stop is under their live minimum, silently preventing any trade execution.
 */
export function getMinStopDistance(epic: string, entryPrice: number): number {
  if (epic.includes("BTC"))  return entryPrice * 0.005;  // 0.5 % — live safe
  if (epic.includes("ETH"))  return entryPrice * 0.005;  // 0.5 % — live safe
  if (epic === "GOLD"  || epic.includes("XAU")) return entryPrice * 0.003;  // 0.3 %
  if (epic === "SILVER" || epic.includes("XAG")) return entryPrice * 0.003;  // 0.3 %
  return entryPrice * 0.001; // forex ~10 pips on EURUSD — live minimum
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fixed USD take-profit / stop-loss targets
 *
 * Requirement (Aug 2026): with the default $350,000 notional at 20x leverage
 * (≈ $17,500 margin), every trade must exit at:
 *
 *   Take profit : 31.6 % of margin = $5,530
 *   Stop loss   : 26.6 % of margin = $4,655
 *
 * These are absolute USD P&L amounts on the position, converted into price
 * levels using the order size, so they hold for any instrument.
 * ──────────────────────────────────────────────────────────────────────────*/

export const DEFAULT_TAKE_PROFIT_MARGIN_PCT = 31.6;
export const DEFAULT_STOP_LOSS_MARGIN_PCT = 26.6;
/** 31.6 % of the $17,500 margin = $5,530 */
export const DEFAULT_TAKE_PROFIT_USD =
  (DEFAULT_TRADE_MARGIN_USD * DEFAULT_TAKE_PROFIT_MARGIN_PCT) / 100;
/** 26.6 % of the $17,500 margin = $4,655 */
export const DEFAULT_STOP_LOSS_USD =
  (DEFAULT_TRADE_MARGIN_USD * DEFAULT_STOP_LOSS_MARGIN_PCT) / 100;

/**
 * Convert an absolute USD P&L amount into the price distance required for a
 * given order size.
 *
 *   USD-quote instruments (EURUSD, GOLD, BTCUSD…): pnl = size × priceDiff
 *   USD-base forex (USDJPY, USDCHF):               pnl = size × priceDiff / price
 */
export function usdAmountToPriceDistance(
  amountUsd: number,
  size: number,
  entryPrice: number,
  epic: string,
): number {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Invalid size for USD→price conversion: ${size}`);
  }
  const normalizedEpic = epic.toUpperCase();
  const isUsdBaseForex =
    normalizedEpic.startsWith("USD") &&
    !normalizedEpic.includes("BTC") &&
    !normalizedEpic.includes("ETH");

  return isUsdBaseForex
    ? (amountUsd * entryPrice) / size
    : amountUsd / size;
}

export interface FixedUsdTargetsParams {
  entryPrice: number;
  size: number;
  epic: string;
  direction: "BUY" | "SELL";
  takeProfitUsd?: number;
  stopLossUsd?: number;
}

export interface FixedUsdTargetsResult {
  stopLoss: number;
  takeProfit: number;
  stopDistance: number;
  targetDistance: number;
  takeProfitUsd: number;
  stopLossUsd: number;
  /** True when the SL had to be widened to the broker minimum stop distance. */
  stopWidened: boolean;
}

/**
 * Build stop-loss / take-profit PRICE levels that correspond to fixed USD
 * P&L amounts on the position. The stop is widened to the instrument minimum
 * if the USD-derived distance is tighter than what Capital.com accepts.
 */
export function calculateFixedUsdTargets(
  params: FixedUsdTargetsParams,
): FixedUsdTargetsResult {
  const {
    entryPrice,
    size,
    epic,
    direction,
    takeProfitUsd = DEFAULT_TAKE_PROFIT_USD,
    stopLossUsd = DEFAULT_STOP_LOSS_USD,
  } = params;

  let stopDistance = usdAmountToPriceDistance(stopLossUsd, size, entryPrice, epic);
  const targetDistance = usdAmountToPriceDistance(takeProfitUsd, size, entryPrice, epic);

  const minStop = getMinStopDistance(epic, entryPrice);
  const stopWidened = stopDistance < minStop;
  if (stopWidened) stopDistance = minStop;

  const stopLoss =
    direction === "BUY" ? entryPrice - stopDistance : entryPrice + stopDistance;
  const takeProfit =
    direction === "BUY" ? entryPrice + targetDistance : entryPrice - targetDistance;

  return {
    stopLoss,
    takeProfit,
    stopDistance,
    targetDistance,
    takeProfitUsd,
    stopLossUsd,
    stopWidened,
  };
}
