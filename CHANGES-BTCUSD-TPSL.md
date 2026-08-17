# Update: BTCUSD-only scanning + fixed TP/SL on 17,500 USD margin

## Sizing (unchanged defaults, confirmed)
- `TRADE_NOTIONAL_USD` = 350,000 USD, `TRADE_LEVERAGE` = 20 -> margin 17,500 USD per trade.

## Fixed exits (now percentage-driven)
`artifacts/api-server/src/lib/riskManager.ts`
- `DEFAULT_STOP_LOSS_MARGIN_PCT = 26.6` -> `DEFAULT_STOP_LOSS_USD = 4,655`
- `DEFAULT_TAKE_PROFIT_MARGIN_PCT = 31.6` -> `DEFAULT_TAKE_PROFIT_USD = 5,530`
- Applied on every order and re-anchored on the actual fill price in `botRunner.ts`.

## Single market
- `botRunner.ts`: `ONLY_MARKET_EPIC = "BTCUSD"`; the scan loop always uses `[ "BTCUSD" ]`.
- `routes/markets.ts`: `DEFAULT_MARKETS = ["BTCUSD"]`, DB list ignored.
- `routes/settings.ts`: GET returns `["BTCUSD"]`; PUT normalises any list to `BTCUSD`.
- `routes/bot.ts`: `activeMarkets` = 1.
- `lib/db/src/schema/botSettings.ts` + `scripts/init-db.mjs`: default `BTCUSD`, and existing rows are updated to `BTCUSD` on init.

## Files changed
- artifacts/api-server/src/lib/riskManager.ts
- artifacts/api-server/src/lib/botRunner.ts
- artifacts/api-server/src/routes/markets.ts
- artifacts/api-server/src/routes/settings.ts
- artifacts/api-server/src/routes/bot.ts
- lib/db/src/schema/botSettings.ts
- scripts/init-db.mjs
- .env.example
