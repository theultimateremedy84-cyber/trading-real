import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db";

const MARKET_MAP: Record<string, string> = {
  BTCUSD: "Bitcoin",
  ETHUSD: "Ethereum",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  GOLD: "Gold",
  SILVER: "Silver",
  AUDUSD: "AUD/USD",
};

// SINGLE-MARKET MODE: only BTCUSD is tracked.
const DEFAULT_MARKETS = ["BTCUSD"];

function determineTrend(change: number): "BULLISH" | "BEARISH" | "SIDEWAYS" {
  if (change > 0.1) return "BULLISH";
  if (change < -0.1) return "BEARISH";
  return "SIDEWAYS";
}

const router: IRouter = Router();

router.get("/markets", async (req, res) => {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1);
    // Single-market mode: ignore anything else stored in settings.
    void settings;
    const enabledMarkets = DEFAULT_MARKETS;

    const client = getBotClient();

    if (!client) {
      const result = enabledMarkets.map((epic: string) => ({
        epic,
        name: MARKET_MAP[epic] ?? epic,
        bid: 0,
        offer: 0,
        change: 0,
        changePercent: 0,
        high: 0,
        low: 0,
        marketStatus: "OFFLINE" as const,
        spread: 0,
        lastUpdated: new Date().toISOString(),
        trend: "SIDEWAYS" as const,
        activeSignal: null,
      }));
      res.json(result);
      return;
    }

    const marketDataList = await Promise.allSettled(
      enabledMarkets.map((epic: string) => client.getSingleMarket(epic))
    );

    const result = enabledMarkets.map((epic: string, idx: number) => {
      const settled = marketDataList[idx];
      const md = settled.status === "fulfilled" ? settled.value : null;

      return {
        epic,
        name: MARKET_MAP[epic] ?? epic,
        bid: md?.bid ?? 0,
        offer: md?.offer ?? 0,
        change: md?.netChange ?? 0,
        changePercent: md?.percentageChange ?? 0,
        high: md?.high ?? 0,
        low: md?.low ?? 0,
        marketStatus: (md?.marketStatus ?? "OFFLINE") as "TRADEABLE" | "CLOSED" | "OFFLINE",
        spread: md ? Math.abs(md.offer - md.bid) : 0,
        lastUpdated: new Date().toISOString(),
        trend: determineTrend(md?.percentageChange ?? 0),
        activeSignal: null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get markets");
    res.status(500).json({ error: "Failed to get markets" });
  }
});

export default router;
