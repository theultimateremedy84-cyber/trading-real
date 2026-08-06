import { useGetSignalById } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatDateTime, cn } from "@/lib/utils";
import { ArrowLeft, Target } from "lucide-react";
import { Link, useParams } from "wouter";

export default function SignalDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data: signal, isLoading, error } = useGetSignalById(id, { query: { enabled: !isNaN(id) } });

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center font-mono text-muted-foreground text-sm">
      LOADING_SIGNAL...
    </div>
  );

  if (error || !signal) return (
    <div className="space-y-4">
      <Link href="/signals">
        <button className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> BACK_TO_SIGNALS
        </button>
      </Link>
      <div className="flex h-64 items-center justify-center font-mono text-destructive text-sm">
        SIGNAL_NOT_FOUND
      </div>
    </div>
  );

  const rows = [
    { label: "Epic", value: signal.epic },
    { label: "Direction", value: <Badge variant={signal.direction === "BUY" ? "default" : "destructive"} className="text-[10px]">{signal.direction}</Badge> },
    { label: "Signal Type", value: signal.signalType.replace(/_/g, " ") },
    { label: "Timeframe", value: signal.timeframe },
    { label: "Entry Price", value: formatNumber(signal.entryPrice) },
    { label: "Stop Loss", value: <span className="text-destructive">{formatNumber(signal.stopLoss)}</span> },
    { label: "Take Profit", value: <span className="text-primary">{formatNumber(signal.takeProfit)}</span> },
    { label: "Kill Zone", value: signal.killZone ?? "—" },
    { label: "HTF Bias", value: signal.htfBias ?? "—" },
    { label: "Structure", value: signal.structureContext ?? "—" },
    { label: "Detected At", value: formatDateTime(signal.detectedAt) },
    { label: "Executed", value: signal.executed ? <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">EXECUTED</Badge> : <Badge variant="outline" className="text-[10px]">PENDING</Badge> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/signals">
          <button className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> BACK_TO_SIGNALS
          </button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight font-sans">{signal.market}</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Signal #{signal.id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" /> Signal Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between border-b border-border/30 pb-2 last:border-0 last:pb-0">
                <span className="text-xs font-mono text-muted-foreground uppercase">{label}</span>
                <span className="text-xs font-mono font-semibold">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-mono mb-3">
              <span className={cn(
                signal.confidence > 70 ? "text-primary" :
                signal.confidence > 50 ? "text-yellow-500" : "text-destructive"
              )}>{signal.confidence}%</span>
            </div>
            <div className="h-3 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  signal.confidence > 70 ? "bg-primary" :
                  signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive"
                )}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
            {signal.notes && (
              <p className="mt-4 text-xs font-mono text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                {signal.notes}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
