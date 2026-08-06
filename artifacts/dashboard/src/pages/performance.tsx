import { useGetPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrencySigned, formatCurrency, cn, cnProfitLoss } from "@/lib/utils";
import { BarChart2, TrendingUp, TrendingDown, Award } from "lucide-react";

export default function Performance() {
  const { data: perf } = useGetPerformance({ query: { refetchInterval: 30000 } });

  const stats = perf ? [
    { label: "Total Trades", value: perf.totalTrades, mono: true },
    { label: "Win Rate", value: `${perf.winRate.toFixed(1)}%`, mono: true, color: perf.winRate >= 50 ? "text-primary" : "text-destructive" },
    { label: "Total P&L", value: formatCurrencySigned(perf.totalPnl), mono: true, color: cnProfitLoss(perf.totalPnl) },
    { label: "Today P&L", value: formatCurrencySigned(perf.todayPnl), mono: true, color: cnProfitLoss(perf.todayPnl) },
    { label: "Week P&L", value: formatCurrencySigned(perf.weekPnl), mono: true, color: cnProfitLoss(perf.weekPnl) },
    { label: "Month P&L", value: formatCurrencySigned(perf.monthPnl), mono: true, color: cnProfitLoss(perf.monthPnl) },
    { label: "Avg RR", value: `${perf.avgRR.toFixed(2)}R`, mono: true },
    { label: "Best Trade", value: formatCurrencySigned(perf.bestTrade), mono: true, color: "text-primary" },
    { label: "Worst Trade", value: formatCurrencySigned(perf.worstTrade), mono: true, color: "text-destructive" },
    { label: "Max Drawdown", value: formatCurrency(perf.maxDrawdown), mono: true },
    { label: "Sharpe Ratio", value: perf.sharpeRatio != null ? perf.sharpeRatio.toFixed(2) : "—", mono: true },
    { label: "Consec. Wins", value: perf.consecutiveWins ?? 0, mono: true },
    { label: "Consec. Losses", value: perf.consecutiveLosses ?? 0, mono: true },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Performance</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Trading statistics and metrics</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {stats.map(({ label, value, mono, color }) => (
          <Card key={label} className="border-border">
            <CardContent className="p-4">
              <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">{label}</div>
              <div className={cn("text-xl font-bold", mono && "font-mono", color)}>{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {perf && perf.byMarket && perf.byMarket.length > 0 && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
              <BarChart2 className="h-4 w-4" /> By Market
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {perf.byMarket.map((m) => (
                <div key={m.epic} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                  <div>
                    <div className="font-mono font-semibold text-xs">{m.market}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {m.trades} trades · {m.wins}W / {m.losses}L · {(m.winRate ?? 0).toFixed(1)}%
                    </div>
                  </div>
                  <div className={cn("font-mono font-bold text-sm", cnProfitLoss(m.pnl))}>
                    {formatCurrencySigned(m.pnl)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!perf && (
        <div className="flex h-32 items-center justify-center font-mono text-muted-foreground text-sm">
          LOADING_PERFORMANCE...
        </div>
      )}
    </div>
  );
}
