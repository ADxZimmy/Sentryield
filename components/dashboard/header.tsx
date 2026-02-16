"use client";

import { useMemo, useState } from "react";
import { ChevronDown, LogOut, Network, Wallet } from "lucide-react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { AgentStatus } from "@/lib/types";

interface HeaderProps {
  status: AgentStatus;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getConnectorMeta(connectorName: string, connectorId: string): {
  label: string;
  description: string;
  rank: number;
  badge: string | null;
} {
  const normalized = `${connectorName} ${connectorId}`.toLowerCase();
  if (normalized.includes("metamask")) {
    return {
      label: "MetaMask",
      description: "Recommended for desktop EVM wallet flows.",
      rank: 0,
      badge: "Recommended"
    };
  }
  if (normalized.includes("injected")) {
    return {
      label: "Browser Wallet",
      description: "Use Rabby, Brave, Phantom EVM, or any injected wallet.",
      rank: 1,
      badge: null
    };
  }
  if (normalized.includes("coinbase")) {
    return {
      label: "Coinbase Wallet",
      description: "Works with Coinbase Wallet browser extension and app.",
      rank: 2,
      badge: null
    };
  }
  if (normalized.includes("walletconnect")) {
    return {
      label: "WalletConnect (QR)",
      description: "Scan QR with mobile wallets.",
      rank: 3,
      badge: "Mobile"
    };
  }
  return {
    label: connectorName,
    description: "Standard EVM wallet connector.",
    rank: 10,
    badge: null
  };
}

export function Header({ status }: HeaderProps) {
  const [walletError, setWalletError] = useState<string | null>(null);
  const { address, isConnected, connector: activeConnector } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, error: connectError, isPending, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const targetChainId = useMemo(() => {
    const raw = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "143");
    return Number.isFinite(raw) ? raw : 143;
  }, []);

  const connectorOptions = useMemo(() => {
    return connectors
      .map((connector, index) => {
        const connectorName =
          typeof connector === "object" &&
          connector !== null &&
          "name" in connector &&
          typeof connector.name === "string"
            ? connector.name
            : `Wallet ${index + 1}`;
        const connectorId =
          typeof connector === "object" &&
          connector !== null &&
          "id" in connector &&
          typeof connector.id === "string"
            ? connector.id
            : `connector-${index}`;
        const connectorUid =
          typeof connector === "object" &&
          connector !== null &&
          "uid" in connector &&
          typeof connector.uid === "string"
            ? connector.uid
            : connectorId;

        return {
          connector,
          connectorId,
          connectorName,
          connectorUid,
          ...getConnectorMeta(connectorName, connectorId)
        };
      })
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        return left.label.localeCompare(right.label);
      });
  }, [connectors]);

  const isWrongNetwork = isConnected && chainId !== targetChainId;
  const hasWalletConnect = connectorOptions.some((option) =>
    `${option.connectorName} ${option.connectorId}`.toLowerCase().includes("walletconnect")
  );
  const pendingConnectorId =
    variables?.connector &&
    typeof variables.connector === "object" &&
    "id" in variables.connector &&
    typeof variables.connector.id === "string"
      ? variables.connector.id
      : null;
  const activeError = walletError ?? connectError?.message ?? null;

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center">
          <img
            src="/SentryieldIconBlack.svg"
            alt="Sentryield logo"
            className="h-7 w-7 dark:hidden"
          />
          <img
            src="/SentryieldIconWhite.svg"
            alt="Sentryield logo"
            className="hidden h-7 w-7 dark:block"
          />
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Sentryield
        </h1>
        <Badge
          variant={status === "ACTIVE" ? "default" : "secondary"}
          className={
            status === "ACTIVE"
              ? "bg-success text-success-foreground"
              : "bg-muted text-muted-foreground"
          }
        >
          {status}
        </Badge>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge
              variant="outline"
              className={
                isWrongNetwork
                  ? "border-destructive text-destructive"
                  : "border-success text-success"
              }
            >
              {isWrongNetwork ? `Wrong Network (${chainId})` : "Monad Mainnet"}
            </Badge>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 bg-transparent">
                <Wallet className="h-4 w-4" />
                {isPending
                  ? "Connecting..."
                  : isConnected && address
                    ? shortAddress(address)
                    : "Connect EVM Wallet"}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {!isConnected ? (
                <>
                  <DropdownMenuLabel>EVM wallet adapters</DropdownMenuLabel>
                  {connectorOptions.map(
                    ({ connector, connectorId, connectorUid, label, description, badge }) => (
                      <DropdownMenuItem
                        key={connectorUid}
                        className="items-start py-2"
                        onClick={() => {
                          setWalletError(null);
                          connect({ connector });
                        }}
                      >
                        <Wallet className="mt-0.5 h-4 w-4" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium">
                            {label}
                            {isPending && pendingConnectorId === connectorId
                              ? " (connecting...)"
                              : ""}
                          </span>
                          <span className="text-xs text-muted-foreground">{description}</span>
                        </div>
                        {badge ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {badge}
                          </Badge>
                        ) : null}
                      </DropdownMenuItem>
                    )
                  )}
                  {!hasWalletConnect ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled>
                        WalletConnect QR unavailable (set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and redeploy)
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <DropdownMenuLabel>
                    Connected {address ? shortAddress(address) : ""}
                    {activeConnector ? ` via ${activeConnector.name}` : ""}
                  </DropdownMenuLabel>
                  {isWrongNetwork ? (
                    <DropdownMenuItem
                      onClick={() => {
                        setWalletError(null);
                        switchChain({ chainId: targetChainId });
                      }}
                      disabled={isSwitching}
                    >
                      <Network className="h-4 w-4" />
                      {isSwitching
                        ? "Switching..."
                        : `Switch to Monad (${targetChainId})`}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      setWalletError(null);
                      disconnect();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Disconnect
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {activeError ? (
          <p className="max-w-72 text-right text-xs text-warning">{activeError}</p>
        ) : null}
      </div>
    </header>
  );
}
