import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { Address, PolicyConfig, PoolConfig, RuntimeConfig, TokenConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV_PATH = join(__dirname, "..", "..", ".env");
const CWD_ENV_PATH = join(process.cwd(), ".env");

// Prefer workspace-root .env, then current working directory, then ambient environment.
loadEnv({ path: ROOT_ENV_PATH });
loadEnv({ path: CWD_ENV_PATH });
loadEnv();

const CHAIN_CONFIG_PATH = join(__dirname, "..", "config", "curvance.monad.mainnet.json");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

interface CurvanceMainnetConfig {
  chainId: number;
  rpcUrl: string;
  explorerTxBaseUrl: string;
  tokens: {
    USDC: Address;
    MON: Address;
    WMON: Address;
  };
  curvance: {
    centralRegistry: Address;
    usdcMarket: Address;
    receiptToken: Address;
    routerOrController: Address;
  };
}

const CHAIN_CONFIG = JSON.parse(
  readFileSync(CHAIN_CONFIG_PATH, "utf8")
) as CurvanceMainnetConfig;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid number for ${name}: ${raw}`);
  }
  return value;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw) return fallback;
  return BigInt(raw);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.toLowerCase() === "true";
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed || fallback;
}

function envCsvUpper(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return values.length ? values : fallback;
}

export const TOKENS: TokenConfig = {
  USDC: CHAIN_CONFIG.tokens.USDC,
  MON: CHAIN_CONFIG.tokens.MON,
  WMON: CHAIN_CONFIG.tokens.WMON
};

export const POLICY: PolicyConfig = {
  minHoldSeconds: 24 * 60 * 60,
  rotationDeltaApyBps: 200,
  maxPaybackHours: 72,
  depegThresholdBps: 100,
  maxPriceImpactBps: 30,
  aprCliffDropBps: 5000,
  txDeadlineSeconds: envNumber("TX_DEADLINE_SECONDS", 1_800)
};

export const POOLS: PoolConfig[] = [
  {
    id: "curvance-usdc-market",
    protocol: "Curvance",
    pair: "USDC/MON",
    tier: "S",
    enabled: true,
    adapterId: "curvance",
    tokenIn: TOKENS.USDC,
    target: (process.env.CURVANCE_TARGET_ADAPTER_ADDRESS ?? ZERO_ADDRESS) as Address,
    pool: CHAIN_CONFIG.curvance.usdcMarket,
    lpToken: CHAIN_CONFIG.curvance.receiptToken,
    baseApyBps: envNumber("BASE_APY_BPS_CURVANCE_USDC", 420),
    rewardTokenSymbol: "USDC",
    rewardRatePerSecond: envNumber("CURVANCE_REWARD_RATE_PER_SECOND", 0),
    protocolFeeBps: envNumber("CURVANCE_PROTOCOL_FEE_BPS", 8),
    rotationCostBps: envNumber("CURVANCE_ROTATION_COST_BPS", 12)
  }
];

export const RUNTIME: RuntimeConfig = {
  rpcUrl: process.env.MONAD_RPC_URL ?? CHAIN_CONFIG.rpcUrl,
  chainId: envNumber("MONAD_CHAIN_ID", CHAIN_CONFIG.chainId),
  vaultAddress: (process.env.VAULT_ADDRESS ?? ZERO_ADDRESS) as Address,
  executorPrivateKey: process.env.BOT_EXECUTOR_PRIVATE_KEY as RuntimeConfig["executorPrivateKey"],
  explorerTxBaseUrl: process.env.EXPLORER_TX_BASE_URL ?? CHAIN_CONFIG.explorerTxBaseUrl,
  dryRun: envBool("DRY_RUN", true),
  liveModeArmed: envBool("LIVE_MODE_ARMED", false),
  scanIntervalSeconds: envNumber("SCAN_INTERVAL_SECONDS", 300),
  defaultTradeAmountRaw: envBigInt("DEFAULT_TRADE_AMOUNT_RAW", 1_000_000n),
  enterOnlyMode: envBool("ENTER_ONLY", false),
  maxRotationsPerDay: envNumber("MAX_ROTATIONS_PER_DAY", 1),
  cooldownSeconds: envNumber("COOLDOWN_SECONDS", 21_600)
};

if (!RUNTIME.dryRun && !RUNTIME.executorPrivateKey) {
  throw new Error("BOT_EXECUTOR_PRIVATE_KEY is required when DRY_RUN=false");
}
if (!RUNTIME.dryRun && RUNTIME.vaultAddress === ZERO_ADDRESS) {
  throw new Error("VAULT_ADDRESS is required when DRY_RUN=false");
}
if (!RUNTIME.dryRun && POOLS.some((pool) => pool.target === ZERO_ADDRESS)) {
  throw new Error("CURVANCE_TARGET_ADAPTER_ADDRESS is required when DRY_RUN=false");
}
if (!RUNTIME.dryRun && !RUNTIME.liveModeArmed) {
  console.warn(
    "LIVE_MODE_ARMED=false. Bot is in guarded live mode: simulations run, but broadcasts are blocked."
  );
}

export const STABLE_PRICE_SYMBOLS = envCsvUpper("STABLE_PRICE_SYMBOLS", ["USDC"]);
export const COINGECKO_API_BASE_URL = envString(
  "COINGECKO_API_BASE_URL",
  "https://api.coingecko.com/api/v3"
);
export const PRICE_ORACLE_TIMEOUT_MS = envNumber("PRICE_ORACLE_TIMEOUT_MS", 8_000);
export const PRICE_ORACLE_CACHE_TTL_MS = envNumber("PRICE_ORACLE_CACHE_TTL_MS", 30_000);
export const COINGECKO_ID_BY_SYMBOL: Record<string, string> = {
  USDC: envString("COINGECKO_ID_USDC", "usd-coin"),
  MON: envString("COINGECKO_ID_MON", "monad"),
  AUSD: envString("COINGECKO_ID_AUSD", "")
};

if (!RUNTIME.dryRun) {
  for (const symbol of STABLE_PRICE_SYMBOLS) {
    const id = COINGECKO_ID_BY_SYMBOL[symbol];
    if (!id) {
      throw new Error(
        `Missing COINGECKO_ID_${symbol} while STABLE_PRICE_SYMBOLS includes ${symbol}.`
      );
    }
  }
}

export const POOL_BY_ID = new Map(POOLS.map((pool) => [pool.id, pool]));
export const CURVANCE_MAINNET = CHAIN_CONFIG;
