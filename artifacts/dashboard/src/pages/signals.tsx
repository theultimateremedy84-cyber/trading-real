import { useGetSignals } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatDateShort, cn } from "@/lib/utils";
import { ChevronRight, Target } from "lucide-react";
import { Link } from "wouter";

export default function Signals() {
  const { data: signals } = useGetSignals({ limit: 50 }, { query: { refetchInterval: 15000 } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Signals</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">ICT strategy signals detected by the bot</p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
            <Target className="h-4 w-4" />
            Recent Signals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {signals && signals.length > 0 ? (
            <div className="space-y-1">
              {signals.map((signal) => (
                <Link key={signal.id} href={`/signals/${signal.id}`}>
                  <div className="flex items-center justify-between p-3 hover:bg-muted/40 active:bg-muted/60 rounded-sm transition-colors border border-border/40 hover:border-border mb-1 cursor-pointer group">
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge
                        variant={signal.direction === "BUY" ? "default" : "destructive"}
                        className="text-[9px] px-1 py-0 h-4 shrink-0"
                      >
                        {signal.direction}
                      </Badge>
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-xs group-hover:text-primary transition-colors">{signal.market}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{signal.signalType.replace(/_/g, " ")} · {signal.timeframe}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <div className="text-right hidden sm:block">
                        <div className="text-xs font-mono font-semibold">{formatNumber(signal.entryPrice)}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{formatDateShort(signal.detectedAt)}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-12 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full",
                              signal.confidence > 70 ? "bg-primary" :
                              signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive"
                            )}
                            style={{ width: `${signal.confidence}%` }}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-muted-foreground w-6">{signal.confidence}%</span>
                      </div>
                      {signal.executed && (
                        <Badge variant="outline" className="text-[9px] font-mono px-1 h-4 border-primary/40 text-primary">
                          EXEC
                        </Badge>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm font-mono text-muted-foreground border border-dashed border-border rounded-sm">
              WAITING_FOR_SIGNALS...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
