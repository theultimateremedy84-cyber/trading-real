async function loadSettings() {
  let row: typeof botSettingsTable.$inferSelect | null = null;
  try {
    const rows = await db.select().from(botSettingsTable).limit(1);
    if (rows.length === 0) {
      try {
        const inserted = await db.insert(botSettingsTable).values({}).returning();
        row = inserted[0];
      } catch {
        // DB writable but insert failed — still proceed without a row
      }
    } else {
      row = rows[0];
    }
  } catch (dbErr) {
    logger.warn(
      { err: dbErr },
      "Database unavailable — loading settings from environment variables only."
    );
  }

  const envApiUrl = process.env["CAPITAL_API_BASE_URL"] || process.env["CAPITAL_API_URL"];
  const isDemo = row?.isDemo ?? true;

  return {
    riskPerTrade:         row?.riskPerTrade         ?? 1.0,
    maxOpenTrades:        row?.maxOpenTrades         ?? 3,
    dailyLossLimit:       row?.dailyLossLimit        ?? 3.0,
    dailyProfitTarget:    row?.dailyProfitTarget     ?? 8.0,
    haltOnDailyProfit:    row?.haltOnDailyProfit     ?? true,
    enabledMarkets:       row?.enabledMarkets        ?? "BTCUSD,ETHUSD,EURUSD,GBPUSD,USDJPY,USDCHF,GOLD,SILVER,AUDUSD",
    enabledKillZones:     row?.enabledKillZones      ?? "LONDON,NEW_YORK",
    minConfidence:        row?.minConfidence         ?? 55.0,
    useOrderBlocks:       row?.useOrderBlocks        ?? true,
    useFairValueGaps:     row?.useFairValueGaps      ?? true,
    useLiquiditySweeps:   row?.useLiquiditySweeps    ?? true,
    useBOS:               row?.useBOS               ?? true,
    useChoCH:             row?.useChoCH             ?? true,
    trailingStop:         row?.trailingStop          ?? false,
    minRR:                row?.minRR                ?? 2.0,
    isDemo,
    capitalApiKey:     process.env["CAPITAL_API_KEY"]        || row?.capitalApiKey     || "",
    capitalIdentifier: process.env["CAPITAL_IDENTIFIER"]     || row?.capitalIdentifier || "",
    capitalPassword:   process.env["CAPITAL_PASSWORD"]       || row?.capitalPassword   || "",
    capitalApiUrl: normalizeCapitalUrl(
      envApiUrl || row?.capitalApiUrl,
      isDemo,
    ),
  };
}
