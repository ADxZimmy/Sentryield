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
const PAIRS = ["AUSD/MON", "USDC/MON", "WMON/MON", "shMON/MON", "kMON/MON"] as const;
const CURVANCE_USDC_MARKET_8EE9 = "0x8EE9FC28B8Da872c38A496e9dDB9700bb7261774" as Address;
const CURVANCE_USDC_MARKET_7C9D = "0x7C9d4f1695C6282Da5e5509Aa51fC9fb417C6f1d" as Address;

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

function envAddress(name: string, fallback: Address = ZERO_ADDRESS): Address {
  return envString(name, fallback) as Address;
}

function envPair(
  name: string,
  fallback: (typeof PAIRS)[number]
): (typeof PAIRS)[number] {
  const value = envString(name, fallback);
  if (PAIRS.includes(value as (typeof PAIRS)[number])) {
    return value as (typeof PAIRS)[number];
  }
  throw new Error(`Invalid pair for ${name}: ${value}`);
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

const MIN_HOLD_SECONDS = Math.max(0, envNumber("MIN_HOLD_SECONDS", 0));

export const POLICY: PolicyConfig = {
  minHoldSeconds: MIN_HOLD_SECONDS,
  rotationDeltaApyBps: 200,
  maxPaybackHours: 72,
  depegThresholdBps: 100,
  maxPriceImpactBps: 30,
  aprCliffDropBps: 5000,
  txDeadlineSeconds: envNumber("TX_DEADLINE_SECONDS", 1_800)
};

const CURVANCE_TARGET_ADAPTER = envAddress("CURVANCE_TARGET_ADAPTER_ADDRESS");
const CURVANCE_BASE_APY_BPS = envNumber("BASE_APY_BPS_CURVANCE_USDC", 420);
const CURVANCE_REWARD_RATE_PER_SECOND = envNumber("CURVANCE_REWARD_RATE_PER_SECOND", 0);
const CURVANCE_PROTOCOL_FEE_BPS = envNumber("CURVANCE_PROTOCOL_FEE_BPS", 8);
const CURVANCE_ROTATION_COST_BPS = envNumber("CURVANCE_ROTATION_COST_BPS", 12);

const MORPHO_DEFAULT_PAIR = envPair("MORPHO_PAIR", "USDC/MON");
const MORPHO_TOKEN_IN_ADDRESS = envAddress("MORPHO_TOKEN_IN_ADDRESS", TOKENS.USDC);
const MORPHO_TARGET_ADAPTER_ADDRESS = envAddress("MORPHO_TARGET_ADAPTER_ADDRESS");
const MORPHO_BASE_APY_BPS = envNumber("BASE_APY_BPS_MORPHO", 390);
const MORPHO_REWARD_TOKEN_SYMBOL = envString("MORPHO_REWARD_TOKEN_SYMBOL", "USDC");
const MORPHO_REWARD_RATE_PER_SECOND = envNumber("MORPHO_REWARD_RATE_PER_SECOND", 0);
const MORPHO_PROTOCOL_FEE_BPS = envNumber("MORPHO_PROTOCOL_FEE_BPS", 8);
const MORPHO_ROTATION_COST_BPS = envNumber("MORPHO_ROTATION_COST_BPS", 14);

export const POOLS: PoolConfig[] = [
  {
    id: "curvance-usdc-market",
    protocol: "Curvance",
    pair: "USDC/MON",
    tier: "S",
    enabled: true,
    adapterId: "curvance",
    tokenIn: TOKENS.USDC,
    target: CURVANCE_TARGET_ADAPTER,
    pool: CHAIN_CONFIG.curvance.usdcMarket,
    lpToken: CHAIN_CONFIG.curvance.receiptToken,
    baseApyBps: CURVANCE_BASE_APY_BPS,
    rewardTokenSymbol: "USDC",
    rewardRatePerSecond: CURVANCE_REWARD_RATE_PER_SECOND,
    protocolFeeBps: CURVANCE_PROTOCOL_FEE_BPS,
    rotationCostBps: CURVANCE_ROTATION_COST_BPS
  },
  {
    id: "curvance-usdc-market-8ee9",
    protocol: "Curvance",
    pair: "USDC/MON",
    tier: "S",
    enabled: envBool("CURVANCE_USDC_MARKET_8EE9_ENABLED", false),
    adapterId: "curvance",
    tokenIn: TOKENS.USDC,
    target: CURVANCE_TARGET_ADAPTER,
    pool: envAddress("CURVANCE_USDC_MARKET_8EE9_POOL_ADDRESS", CURVANCE_USDC_MARKET_8EE9),
    lpToken: envAddress(
      "CURVANCE_USDC_MARKET_8EE9_LP_TOKEN_ADDRESS",
      envAddress("CURVANCE_USDC_MARKET_8EE9_POOL_ADDRESS", CURVANCE_USDC_MARKET_8EE9)
    ),
    baseApyBps: envNumber("BASE_APY_BPS_CURVANCE_USDC_8EE9", CURVANCE_BASE_APY_BPS),
    rewardTokenSymbol: "USDC",
    rewardRatePerSecond: CURVANCE_REWARD_RATE_PER_SECOND,
    protocolFeeBps: CURVANCE_PROTOCOL_FEE_BPS,
    rotationCostBps: CURVANCE_ROTATION_COST_BPS
  },
  {
    id: "curvance-usdc-market-7c9d",
    protocol: "Curvance",
    pair: "USDC/MON",
    tier: "S",
    enabled: envBool("CURVANCE_USDC_MARKET_7C9D_ENABLED", false),
    adapterId: "curvance",
    tokenIn: TOKENS.USDC,
    target: CURVANCE_TARGET_ADAPTER,
    pool: envAddress("CURVANCE_USDC_MARKET_7C9D_POOL_ADDRESS", CURVANCE_USDC_MARKET_7C9D),
    lpToken: envAddress(
      "CURVANCE_USDC_MARKET_7C9D_LP_TOKEN_ADDRESS",
      envAddress("CURVANCE_USDC_MARKET_7C9D_POOL_ADDRESS", CURVANCE_USDC_MARKET_7C9D)
    ),
    baseApyBps: envNumber("BASE_APY_BPS_CURVANCE_USDC_7C9D", CURVANCE_BASE_APY_BPS),
    rewardTokenSymbol: "USDC",
    rewardRatePerSecond: CURVANCE_REWARD_RATE_PER_SECOND,
    protocolFeeBps: CURVANCE_PROTOCOL_FEE_BPS,
    rotationCostBps: CURVANCE_ROTATION_COST_BPS
  },
  {
    id: "morpho-usdc-vault",
    protocol: "Morpho",
    pair: MORPHO_DEFAULT_PAIR,
    tier: "S",
    enabled: envBool("MORPHO_ENABLED", false),
    adapterId: "morpho",
    tokenIn: MORPHO_TOKEN_IN_ADDRESS,
    target: MORPHO_TARGET_ADAPTER_ADDRESS,
    pool: envAddress("MORPHO_POOL_ADDRESS"),
    lpToken: envAddress("MORPHO_LP_TOKEN_ADDRESS", envAddress("MORPHO_POOL_ADDRESS")),
    baseApyBps: MORPHO_BASE_APY_BPS,
    rewardTokenSymbol: MORPHO_REWARD_TOKEN_SYMBOL,
    rewardRatePerSecond: MORPHO_REWARD_RATE_PER_SECOND,
    protocolFeeBps: MORPHO_PROTOCOL_FEE_BPS,
    rotationCostBps: MORPHO_ROTATION_COST_BPS
  },
  {
    id: "morpho-usdc-vault-7899",
    protocol: "Morpho",
    pair: envPair("MORPHO_POOL_2_PAIR", MORPHO_DEFAULT_PAIR),
    tier: "S",
    enabled: envBool("MORPHO_POOL_2_ENABLED", false),
    adapterId: "morpho",
    tokenIn: envAddress("MORPHO_POOL_2_TOKEN_IN_ADDRESS", MORPHO_TOKEN_IN_ADDRESS),
    target: envAddress("MORPHO_POOL_2_TARGET_ADAPTER_ADDRESS", MORPHO_TARGET_ADAPTER_ADDRESS),
    pool: envAddress("MORPHO_POOL_2_ADDRESS"),
    lpToken: envAddress(
      "MORPHO_POOL_2_LP_TOKEN_ADDRESS",
      envAddress("MORPHO_POOL_2_ADDRESS")
    ),
    baseApyBps: envNumber("BASE_APY_BPS_MORPHO_POOL_2", MORPHO_BASE_APY_BPS),
    rewardTokenSymbol: envString("MORPHO_POOL_2_REWARD_TOKEN_SYMBOL", MORPHO_REWARD_TOKEN_SYMBOL),
    rewardRatePerSecond: envNumber(
      "MORPHO_POOL_2_REWARD_RATE_PER_SECOND",
      MORPHO_REWARD_RATE_PER_SECOND
    ),
    protocolFeeBps: envNumber("MORPHO_POOL_2_PROTOCOL_FEE_BPS", MORPHO_PROTOCOL_FEE_BPS),
    rotationCostBps: envNumber("MORPHO_POOL_2_ROTATION_COST_BPS", MORPHO_ROTATION_COST_BPS)
  },
  {
    id: "gearbox-usdc-vault",
    protocol: "Gearbox",
    pair: envPair("GEARBOX_PAIR", "USDC/MON"),
    tier: "S",
    enabled: envBool("GEARBOX_ENABLED", false),
    adapterId: "gearbox",
    tokenIn: envAddress("GEARBOX_TOKEN_IN_ADDRESS", TOKENS.USDC),
    target: envAddress("GEARBOX_TARGET_ADAPTER_ADDRESS"),
    pool: envAddress("GEARBOX_POOL_ADDRESS"),
    lpToken: envAddress("GEARBOX_LP_TOKEN_ADDRESS", envAddress("GEARBOX_POOL_ADDRESS")),
    baseApyBps: envNumber("BASE_APY_BPS_GEARBOX", 380),
    rewardTokenSymbol: envString("GEARBOX_REWARD_TOKEN_SYMBOL", "USDC"),
    rewardRatePerSecond: envNumber("GEARBOX_REWARD_RATE_PER_SECOND", 0),
    protocolFeeBps: envNumber("GEARBOX_PROTOCOL_FEE_BPS", 9),
    rotationCostBps: envNumber("GEARBOX_ROTATION_COST_BPS", 15)
  },
  {
    id: "townsquare-usdc-vault",
    protocol: "TownSquare",
    pair: envPair("TOWNSQUARE_PAIR", "USDC/MON"),
    tier: "S",
    enabled: envBool("TOWNSQUARE_ENABLED", false),
    adapterId: "townsquare",
    tokenIn: envAddress("TOWNSQUARE_TOKEN_IN_ADDRESS", TOKENS.USDC),
    target: envAddress("TOWNSQUARE_TARGET_ADAPTER_ADDRESS"),
    pool: envAddress("TOWNSQUARE_POOL_ADDRESS"),
    lpToken: envAddress(
      "TOWNSQUARE_LP_TOKEN_ADDRESS",
      envAddress("TOWNSQUARE_POOL_ADDRESS")
    ),
    baseApyBps: envNumber("BASE_APY_BPS_TOWNSQUARE", 360),
    rewardTokenSymbol: envString("TOWNSQUARE_REWARD_TOKEN_SYMBOL", "USDC"),
    rewardRatePerSecond: envNumber("TOWNSQUARE_REWARD_RATE_PER_SECOND", 0),
    protocolFeeBps: envNumber("TOWNSQUARE_PROTOCOL_FEE_BPS", 9),
    rotationCostBps: envNumber("TOWNSQUARE_ROTATION_COST_BPS", 16)
  },
  {
    id: "neverland-usdc-vault",
    protocol: "Neverland",
    pair: envPair("NEVERLAND_PAIR", "USDC/MON"),
    tier: "S",
    enabled: envBool("NEVERLAND_ENABLED", false),
    adapterId: "neverland",
    tokenIn: envAddress("NEVERLAND_TOKEN_IN_ADDRESS", TOKENS.USDC),
    target: envAddress("NEVERLAND_TARGET_ADAPTER_ADDRESS"),
    pool: envAddress("NEVERLAND_POOL_ADDRESS"),
    lpToken: envAddress(
      "NEVERLAND_LP_TOKEN_ADDRESS",
      envAddress("NEVERLAND_POOL_ADDRESS")
    ),
    baseApyBps: envNumber("BASE_APY_BPS_NEVERLAND", 350),
    rewardTokenSymbol: envString("NEVERLAND_REWARD_TOKEN_SYMBOL", "USDC"),
    rewardRatePerSecond: envNumber("NEVERLAND_REWARD_RATE_PER_SECOND", 0),
    protocolFeeBps: envNumber("NEVERLAND_PROTOCOL_FEE_BPS", 10),
    rotationCostBps: envNumber("NEVERLAND_ROTATION_COST_BPS", 16)
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
if (
  !RUNTIME.dryRun &&
  POOLS.some(
    (pool) =>
      pool.enabled &&
      (pool.target === ZERO_ADDRESS ||
        pool.pool === ZERO_ADDRESS ||
        pool.lpToken === ZERO_ADDRESS ||
        pool.tokenIn === ZERO_ADDRESS)
  )
) {
  throw new Error(
    "Enabled pools require non-zero target/pool/lpToken/tokenIn addresses when DRY_RUN=false."
  );
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
