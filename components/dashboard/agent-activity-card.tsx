"use client";

import { Activity, Wallet, Bot, Clock3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LatestDecision } from "@/lib/types";

interface AgentActivityCardProps {
  vaultUsdcBalance: number | null;
  latestDecision: LatestDecision | null;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function AgentActivityCard({
  vaultUsdcBalance,
  latestDecision
}: AgentActivityCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-primary" />
          Agent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            Vault USDC balance
          </p>
          <p className="text-lg font-semibold text-foreground">
            {vaultUsdcBalance === null ? "Unavailable" : `${vaultUsdcBalance.toFixed(6)} USDC`}
          </p>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Bot className="h-3.5 w-3.5" />
            Latest agent decision
          </p>
          {latestDecision ? (
            <>
              <p className="text-sm font-medium text-foreground">{latestDecision.action}</p>
              <p className="mt-1 text-xs text-muted-foreground">{latestDecision.reason}</p>
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                {formatTimestamp(latestDecision.timestamp)}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No decision yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
