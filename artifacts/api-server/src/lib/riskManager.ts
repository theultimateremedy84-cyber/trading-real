/**
 * Risk Management Module
 * - Position sizing based on account balance and risk %
 * - Daily loss limit enforcement
 * - Max open trades enforcement
 */

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

export interface DailyRiskState {
  tradesToday: number;
  pnlToday: number;
  dailyLossLimit: number; // as percentage
  accountBalance: number;
}

export function isDailyLossLimitBreached(state: DailyRiskState): boolean {
  const limitAmount = (state.accountBalance * state.dailyLossLimit) / 100;
  return state.pnlToday <= -Math.abs(limitAmount);
}

export function canOpenNewTrade(
  openPositionsCount: number,
  maxOpenTrades: number,
  dailyRisk: DailyRiskState
): { allowed: boolean; reason?: string } {
  if (isDailyLossLimitBreached(dailyRisk)) {
    return {
      allowed: false,
      reason: `Daily loss limit of ${dailyRisk.dailyLossLimit}% breached (${dailyRisk.pnlToday.toFixed(2)})`,
    };
  }

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
 * Maximum position size per instrument.
 * Keeps the notional exposure within typical Capital.com live account limits.
 *
 * FIX (live Aug 2026): forex max updated from 2 "lots" to 200,000 units
 * (= 2 standard lots) to match the unit-based size convention.
 */
export function getMaxSizeForEpic(epic: string): number {
  if (epic.includes("BTC"))  return 0.05;    // ~$3,200 notional at $64k
  if (epic.includes("ETH"))  return 1;       // ~$1,880 notional
  if (epic === "GOLD"  || epic.includes("XAU")) return 2;
  if (epic === "SILVER" || epic.includes("XAG")) return 20;
  return 200_000; // forex — 200,000 units = 2 standard lots
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
