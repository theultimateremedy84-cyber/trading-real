import { useGetTrades } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrencySigned, formatNumber, formatDateShort, cn, cnProfitLoss } from "@/lib/utils";
import { ListOrdered } from "lucide-react";

export default function Trades() {
  const { data: trades } = useGetTrades({ limit: 100 }, { query: { refetchInterval: 30000 } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Trades</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Full trade history</p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            Trade History ({trades?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trades && trades.length > 0 ? (
            <div className="overflow-x-auto -mx-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead className="hidden sm:table-cell">Size</TableHead>
                    <TableHead className="hidden md:table-cell">Entry</TableHead>
                    <TableHead className="hidden md:table-cell">Exit</TableHead>
                    <TableHead>P&L</TableHead>
                    <TableHead className="hidden sm:table-cell">Result</TableHead>
                    <TableHead className="hidden lg:table-cell">RR</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell className="font-semibold text-foreground text-xs">{trade.market}</TableCell>
                      <TableCell>
                        <Badge
                          variant={trade.direction === "BUY" ? "default" : "destructive"}
                          className="text-[9px] px-1"
                        >
                          {trade.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs">{trade.size}</TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs">{formatNumber(trade.entryPrice, 2)}</TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs">
                        {trade.exitPrice != null ? formatNumber(trade.exitPrice, 2) : "—"}
                      </TableCell>
                      <TableCell className={cn("font-bold font-mono text-xs", cnProfitLoss(trade.profit))}>
                        {trade.profit != null ? formatCurrencySigned(trade.profit) : "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {trade.result ? (
                          <Badge
                            variant={trade.result === "WIN" ? "default" : trade.result === "LOSS" ? "destructive" : "secondary"}
                            className="text-[9px] px-1"
                          >
                            {trade.result}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1">OPEN</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                        {trade.riskRewardRatio != null ? `${trade.riskRewardRatio.toFixed(2)}R` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        {formatDateShort(trade.entryDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm font-mono text-muted-foreground border border-dashed border-border rounded-sm">
              NO_TRADES_YET
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
