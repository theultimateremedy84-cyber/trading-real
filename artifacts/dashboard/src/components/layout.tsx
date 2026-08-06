import { Link, useLocation } from "wouter";
import {
  Activity,
  BarChart2,
  Target,
  Settings,
  Power,
  Radio,
  ListOrdered,
  Menu,
  X,
  AlertOctagon,
} from "lucide-react";
import { useGetBotStatus, useStartBot, useStopBot, useEmergencyStop } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

const links = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/markets", label: "Markets", icon: Radio },
  { href: "/signals", label: "Signals", icon: Target },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/performance", label: "Perf", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function EmergencyStopButton({ size = "default", onDone }: { size?: "default" | "mobile"; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const emergencyStop = useEmergencyStop();

  const handleConfirm = () => {
    emergencyStop.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries();
        const msg = data.closedPositions > 0
          ? `Closed ${data.closedPositions} position${data.closedPositions !== 1 ? "s" : ""}. Bot offline.`
          : "Bot offline. No open positions found.";
        toast({ title: "EMERGENCY STOP EXECUTED", description: msg });
        onDone?.();
      },
      onError: () => {
        toast({ title: "Emergency stop failed", variant: "destructive" });
        onDone?.();
      },
    });
  };

  if (size === "mobile") {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-sm min-w-[48px] transition-colors",
              "text-destructive",
              emergencyStop.isPending && "opacity-60 pointer-events-none"
            )}
            disabled={emergencyStop.isPending}
            aria-label="Emergency Stop"
          >
            <div className="h-5 w-5 flex items-center justify-center rounded-full bg-destructive/15 ring-1 ring-destructive/40">
              <AlertOctagon className="h-3.5 w-3.5 stroke-[2.5px] text-destructive" />
            </div>
            <span className="text-[9px] font-mono font-bold leading-none">PANIC</span>
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="border-destructive/50 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-destructive flex items-center gap-2">
              <AlertOctagon className="h-5 w-5" />
              EMERGENCY STOP
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs">
              This will instantly close ALL open positions and take the bot offline.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">CANCEL</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 font-mono text-xs font-bold"
              onClick={handleConfirm}
            >
              CONFIRM EMERGENCY STOP
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="w-full h-8 font-mono text-xs font-bold ring-1 ring-destructive/60 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
          disabled={emergencyStop.isPending}
        >
          <AlertOctagon className="mr-2 h-3.5 w-3.5" />
          {emergencyStop.isPending ? "STOPPING..." : "EMERGENCY STOP"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-destructive/50 bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-mono text-destructive flex items-center gap-2">
            <AlertOctagon className="h-5 w-5" />
            EMERGENCY STOP
          </AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-xs">
            This will instantly close ALL open positions and take the bot offline.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">CANCEL</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 font-mono text-xs font-bold"
            onClick={handleConfirm}
          >
            CONFIRM EMERGENCY STOP
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isRunning = status?.running;

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  };

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground selection:bg-primary/30">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b border-border px-6">
          <div className="flex items-center gap-2 font-mono font-bold tracking-tight">
            <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            ICT_BOT_V1
          </div>
        </div>

        <div className="flex-1 overflow-auto py-4">
          <nav className="grid gap-1 px-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive(link.href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label === "Perf" ? "Performance" : link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-t border-border p-4 space-y-3">
          {/* Emergency Stop — desktop sidebar */}
          <EmergencyStopButton />

          <div className="rounded-sm border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">System Power</span>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  isRunning ? "bg-primary shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" : "bg-destructive"
                )} />
                <span className="font-mono text-xs text-muted-foreground">
                  {isRunning ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 font-mono text-xs font-bold border-border/60"
                onClick={() => stopBot.mutate()}
                disabled={stopBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" />
                HALT SYSTEM
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="w-full h-8 font-mono text-xs font-bold"
                onClick={() => startBot.mutate()}
                disabled={startBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" />
                INITIALIZE
              </Button>
            )}

            {status?.uptime != null && isRunning && (
              <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>UPTIME</span>
                <span>{Math.floor(status.uptime / 3600)}h {Math.floor((status.uptime % 3600) / 60)}m</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4 md:hidden">
        <div className="flex items-center gap-2 font-mono font-bold tracking-tight text-sm">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Activity className="h-3.5 w-3.5" />
          </div>
          ICT_BOT_V1
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "h-2 w-2 rounded-full",
              isRunning ? "bg-primary animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-destructive"
            )} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {isRunning ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Mobile Slide-down Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-x-0 top-14 z-10 border-b border-border bg-background/98 backdrop-blur shadow-lg md:hidden">
          <nav className="grid gap-1 p-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive(link.href)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label === "Perf" ? "Performance" : link.label}
              </Link>
            ))}
          </nav>
          <div className="p-3 border-t border-border space-y-2">
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9 font-mono text-xs font-bold border-border/60"
                onClick={() => { stopBot.mutate(); setMobileMenuOpen(false); }}
                disabled={stopBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" /> HALT SYSTEM
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="w-full h-9 font-mono text-xs font-bold"
                onClick={() => { startBot.mutate(); setMobileMenuOpen(false); }}
                disabled={startBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" /> INITIALIZE
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex flex-1 flex-col md:pl-60">
        {/* Spacer for mobile top header */}
        <div className="h-14 md:hidden" />
        <div className="flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
        {/* Bottom spacer for mobile bottom nav */}
        <div className="h-16 md:hidden" />
      </main>

      {/* Mobile Bottom Navigation — with PANIC button */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-border bg-background/95 backdrop-blur h-16 px-1 md:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-sm min-w-[40px] transition-colors",
              isActive(link.href)
                ? "text-primary"
                : "text-muted-foreground"
            )}
          >
            <link.icon className={cn("h-5 w-5", isActive(link.href) ? "stroke-[2.5px]" : "stroke-[1.5px]")} />
            <span className="text-[9px] font-mono font-medium leading-none">{link.label}</span>
          </Link>
        ))}

        {/* Panic / Emergency Stop button — bottom nav */}
        <EmergencyStopButton size="mobile" onDone={() => setMobileMenuOpen(false)} />
      </nav>
    </div>
  );
}
