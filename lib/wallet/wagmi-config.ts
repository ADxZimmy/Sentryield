"use client";

import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask, walletConnect } from "wagmi/connectors";
import { monadMainnet } from "@/lib/wallet/monad-chain";

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://sentryield.vercel.app";
const appBaseUrl = appUrl.replace(/\/$/, "");
const configuredIconUrl = process.env.NEXT_PUBLIC_APP_ICON_URL?.trim() || "";
const iconUrl =
  configuredIconUrl !== ""
    ? encodeURI(configuredIconUrl)
    : `${appBaseUrl}/SentryieldIconBlack.png`;
const hasWindow = typeof window !== "undefined";
const hasIndexedDb = typeof indexedDB !== "undefined";
const shouldEnableBrowserConnectors = hasWindow;
const shouldEnableWalletConnect = hasWindow && hasIndexedDb && walletConnectProjectId !== "";

const connectors = shouldEnableBrowserConnectors
  ? [
      metaMask(),
      injected(),
      coinbaseWallet({
        appName: "Sentryield",
        appLogoUrl: iconUrl
      }),
      ...(shouldEnableWalletConnect
        ? [
            walletConnect({
              projectId: walletConnectProjectId,
              showQrModal: true,
              metadata: {
                name: "Sentryield",
                description: "Sentryield dashboard and automation controls",
                url: appUrl,
                icons: [iconUrl]
              }
            })
          ]
        : [])
    ]
  : [];

export const wagmiConfig = createConfig({
  chains: [monadMainnet],
  connectors,
  multiInjectedProviderDiscovery: true,
  transports: {
    [monadMainnet.id]: http(rpcUrl)
  }
});
