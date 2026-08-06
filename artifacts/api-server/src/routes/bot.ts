import { Router, type IRouter } from "express";
import { getBotState, startBot, stopBot, resetSessionPnl, getBotSessionStart } from "../lib/botRunner";
import { db } from "@workspace/db";
import { tradesTable, botSettingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/bot/status", async (req, res) => {
  try {
    const botState = getBotState();

    const [allTrades, settings] = await Promise.all([
      db.select().from(tradesTable),
      db.select().from(botSettingsTable).limit(1),
    ]);

    const openPositions = allTrades.filter((t) => !t.exitDate).length;
    const activeMarkets = settings[0]
      ? settings[0].enabledMarkets.split(",").filter(Boolean).length
      : 8;

    // Compute effectivePnl using the same logic as the halt checks so the
    // dashboard always shows the value the bot is actually acting on.
    // Using sessionStart (not UTC midnight) keeps it consistent with resetSessionPnl().
    const sessionStart = getBotSessionStart();
    const rawSessionPnl = allTrades
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const effectivePnl = rawSessionPnl - botState.sessionPnlOffset;

    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions,
      activeMarkets,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
      effectivePnl,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get bot status");
    res.status(500).json({ error: "Failed to get bot status" });
  }
});

router.post("/bot/start", async (req, res) => {
  try {
    await startBot();
    const botState = getBotState();
    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start bot");
    const msg = err instanceof Error ? err.message : "Failed to start bot";
    res.status(400).json({ error: msg });
  }
});

router.post("/bot/stop", async (req, res) => {
  try {
    await stopBot();
    const botState = getBotState();
    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to stop bot");
    const msg = err instanceof Error ? err.message : "Failed to stop bot";
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /bot/emergency-stop
 *
 * Closes ALL open positions on Capital.com immediately, then stops the bot.
 * This is the "panic button" — use when you want to exit everything and go offline instantly.
 */
router.post("/bot/emergency-stop", async (req, res) => {
  const errors: string[] = [];
  let closedPositions = 0;
  let botStopped = false;

  try {
    const { getBotClient } = await import("../lib/botRunner");
    const client = getBotClient();

    if (client) {
      // Get all open positions and close each one
      let positions: Awaited<ReturnType<typeof client.getPositions>> = [];
      try {
        positions = await client.getPositions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to fetch positions: ${msg}`);
        req.log.error({ err }, "Emergency stop: failed to fetch positions");
      }

      for (const pos of positions) {
        try {
          await client.closePosition(pos.position.dealId);
          closedPositions++;
          req.log.info({ dealId: pos.position.dealId }, "Emergency stop: closed position");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to close ${pos.position.dealId}: ${msg}`);
          req.log.error({ err, dealId: pos.position.dealId }, "Emergency stop: failed to close position");
        }
      }
    }

    // Stop the bot regardless of position-close errors
    try {
      await stopBot();
      botStopped = true;
    } catch (err) {
      // Bot may already be stopped
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not running")) {
        errors.push(`Failed to stop bot: ${msg}`);
        req.log.error({ err }, "Emergency stop: failed to stop bot");
      } else {
        botStopped = true; // It was already offline
      }
    }

    req.log.info({ closedPositions, botStopped, errors }, "Emergency stop executed");
    res.json({ success: true, closedPositions, botStopped, errors });
  } catch (err) {
    req.log.error({ err }, "Emergency stop: unexpected error");
    const msg = err instanceof Error ? err.message : "Emergency stop failed";
    res.status(500).json({ success: false, closedPositions, botStopped, errors: [msg] });
  }
});

/**
 * POST /bot/reset-session
 * Body: { startingPnl?: number }  — defaults to 0 (full reset)
 *
 * Resets the effective session P&L counter without stopping the bot.
 * The halt check on the very next scan will measure P&L from the new baseline.
 */
router.post("/bot/reset-session", async (req, res) => {
  try {
    const { startingPnl = 0 } = req.body as { startingPnl?: number };

    if (typeof startingPnl !== "number" || !isFinite(startingPnl)) {
      res.status(400).json({ error: "startingPnl must be a finite number" });
      return;
    }

    await resetSessionPnl(startingPnl);

    res.json({ success: true, startingPnl });
  } catch (err) {
    req.log.error({ err }, "Failed to reset session P&L");
    const msg = err instanceof Error ? err.message : "Failed to reset session P&L";
    res.status(400).json({ error: msg });
  }
});

export default router;
