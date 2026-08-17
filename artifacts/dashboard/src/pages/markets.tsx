import { useGetMarkets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercentage, cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, Radio } from "lucide-react";

export default function Markets() {
  const { data: markets } = useGetMarkets({ query: { refetchInterval: 5000 } });

  if (!markets) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_MARKETS...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Markets</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Live market data from Capital.com</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {markets.map((market) => (
          <MarketCard key={market.epic} market={market} />
        ))}
      </div>
    </div>
  );
}

function MarketCard({ market }: { market: { epic: string; name: string; bid: number; offer: number; change: number; changePercent: number; high: number; low: number; marketStatus: string; spread: number; trend: string } }) {
  const isUp = market.changePercent > 0;
  const isDown = market.changePercent < 0;
  const TrendIcon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus;

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <Radio className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono text-xs text-muted-foreground">{market.epic}</span>
            </div>
            <div className="font-semibold text-sm mt-0.5">{market.name}</div>
          </div>
          <Badge
            variant={market.marketStatus === "TRADEABLE" ? "default" : "secondary"}
            className="text-[9px] font-mono px-1"
          >
            {market.marketStatus === "TRADEABLE" ? "LIVE" : market.marketStatus}
          </Badge>
        </div>

        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <div className="font-mono text-lg font-bold">{formatNumber(market.bid, 2)}</div>
            <div className={cn("flex items-center gap-0.5 font-mono text-xs font-semibold",
              isUp ? "text-primary" : isDown ? "text-destructive" : "text-muted-foreground"
            )}>
              <TrendIcon className="h-3.5 w-3.5" />
              {formatPercentage(market.changePercent)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground border-t border-border/40 pt-2">
            <div>
              <div className="text-[9px] uppercase mb-0.5">H</div>
              <div>{formatNumber(market.high, 2)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase mb-0.5">L</div>
              <div>{formatNumber(market.low, 2)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase mb-0.5">Spread</div>
              <div>{market.spread.toFixed(5)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase mb-0.5">Trend</div>
              <div className={cn(
                market.trend === "BULLISH" ? "text-primary" :
                market.trend === "BEARISH" ? "text-destructive" :
                "text-muted-foreground"
              )}>{market.trend}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
