import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save, RefreshCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, refetch } = useGetSettings({ query: { refetchInterval: 0 } });
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState({
    capitalIdentifier: "",
    capitalApiKey: "",
    capitalPassword: "",
    capitalApiUrl: "https://api.capital.com",
    isDemo: true,
    riskPerTrade: 1,
    maxOpenTrades: 3,
    dailyLossLimit: 3,
    dailyProfitTarget: 2,
    minConfidence: 65,
    minRR: 2,
    haltOnDailyProfit: true,
    useOrderBlocks: true,
    useFairValueGaps: true,
    useLiquiditySweeps: true,
    useBOS: true,
    useChoCH: true,
    trailingStop: false,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        capitalIdentifier: settings.capitalIdentifier ?? "",
        capitalApiKey: settings.capitalApiKey ?? "",
        capitalPassword: "",
        capitalApiUrl: settings.capitalApiUrl ?? "https://api.capital.com",
        isDemo: settings.isDemo ?? true,
        riskPerTrade: settings.riskPerTrade ?? 1,
        maxOpenTrades: settings.maxOpenTrades ?? 3,
        dailyLossLimit: settings.dailyLossLimit ?? 3,
        dailyProfitTarget: settings.dailyProfitTarget ?? 2,
        minConfidence: settings.minConfidence ?? 65,
        minRR: settings.minRR ?? 2,
        haltOnDailyProfit: settings.haltOnDailyProfit ?? true,
        useOrderBlocks: settings.useOrderBlocks ?? true,
        useFairValueGaps: settings.useFairValueGaps ?? true,
        useLiquiditySweeps: settings.useLiquiditySweeps ?? true,
        useBOS: settings.useBOS ?? true,
        useChoCH: settings.useChoCH ?? true,
        trailingStop: settings.trailingStop ?? false,
      });
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate(
      { data: form },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          refetch();
          toast({ title: "Settings saved" });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      }
    );
  };

  const SwitchRow = ({ label, field }: { label: string; field: keyof typeof form }) => (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-xs font-mono text-muted-foreground">{label}</span>
      <Switch
        checked={!!form[field]}
        onCheckedChange={(v) => setForm((p) => ({ ...p, [field]: v }))}
      />
    </div>
  );

  const NumberRow = ({ label, field, step = 0.1, min = 0 }: { label: string; field: keyof typeof form; step?: number; min?: number }) => (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-xs font-mono text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        min={min}
        value={form[field] as number}
        onChange={(e) => setForm((p) => ({ ...p, [field]: parseFloat(e.target.value) || 0 }))}
        className="h-6 text-xs font-mono w-24 px-2"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-sans">Settings</h1>
          <p className="text-muted-foreground font-mono text-xs mt-1">Bot configuration and credentials</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
            <RefreshCcw className="mr-2 h-3 w-3" /> Refresh
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateSettings.isPending} className="font-mono text-xs">
            <Save className="mr-2 h-3 w-3" /> {updateSettings.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" /> Capital.com Credentials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SwitchRow label="Demo Account" field="isDemo" />
            <div className="py-2 border-b border-border/40">
              <div className="text-xs font-mono text-muted-foreground mb-1">Identifier (email)</div>
              <Input
                value={form.capitalIdentifier}
                onChange={(e) => setForm((p) => ({ ...p, capitalIdentifier: e.target.value }))}
                className="h-7 text-xs font-mono"
                placeholder="your@email.com"
              />
            </div>
            <div className="py-2 border-b border-border/40">
              <div className="text-xs font-mono text-muted-foreground mb-1">API Key</div>
              <Input
                value={form.capitalApiKey}
                onChange={(e) => setForm((p) => ({ ...p, capitalApiKey: e.target.value }))}
                className="h-7 text-xs font-mono"
                placeholder="Enter new API key..."
              />
            </div>
            <div className="py-2 border-b border-border/40">
              <div className="text-xs font-mono text-muted-foreground mb-1">Password</div>
              <Input
                type="password"
                value={form.capitalPassword}
                onChange={(e) => setForm((p) => ({ ...p, capitalPassword: e.target.value }))}
                className="h-7 text-xs font-mono"
                placeholder="Enter new password..."
              />
            </div>
            <div className="py-2">
              <div className="text-xs font-mono text-muted-foreground mb-1">API URL</div>
              <Input
                value={form.capitalApiUrl}
                onChange={(e) => setForm((p) => ({ ...p, capitalApiUrl: e.target.value }))}
                className="h-7 text-xs font-mono"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Risk Management</CardTitle>
          </CardHeader>
          <CardContent>
            <NumberRow label="Risk Per Trade (%)" field="riskPerTrade" step={0.1} min={0.1} />
            <NumberRow label="Max Open Trades" field="maxOpenTrades" step={1} min={1} />
            <NumberRow label="Daily Loss Limit (%)" field="dailyLossLimit" step={0.1} min={0.1} />
            <NumberRow label="Daily Profit Target (%)" field="dailyProfitTarget" step={0.1} min={0.1} />
            <NumberRow label="Min Confidence (%)" field="minConfidence" step={1} min={1} />
            <NumberRow label="Min Risk:Reward" field="minRR" step={0.1} min={0.5} />
            <SwitchRow label="Halt on Daily Profit" field="haltOnDailyProfit" />
            <SwitchRow label="Trailing Stop" field="trailingStop" />
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Strategy Features</CardTitle>
          </CardHeader>
          <CardContent>
            <SwitchRow label="Order Blocks" field="useOrderBlocks" />
            <SwitchRow label="Fair Value Gaps" field="useFairValueGaps" />
            <SwitchRow label="Liquidity Sweeps" field="useLiquiditySweeps" />
            <SwitchRow label="Break of Structure" field="useBOS" />
            <SwitchRow label="Change of Character" field="useChoCH" />
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={updateSettings.isPending} className="font-mono text-xs">
          <Save className="mr-2 h-3 w-3" /> {updateSettings.isPending ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </div>
  );
}
