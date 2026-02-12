import { writeFile } from "node:fs/promises";
import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  type Address
} from "viem";
import { POOLS, RUNTIME, TOKENS } from "./config.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";

interface CheckRow {
  id: string;
  status: CheckStatus;
  detail: string;
}

interface PoolBalanceRow {
  poolId: string;
  lpToken: Address;
  balanceRaw: string;
  balanceFormatted: string;
}

interface VaultSnapshot {
  address: Address;
  usdcBalanceRaw: string;
  usdcBalanceFormatted: string;
  poolLpBalances: PoolBalanceRow[];
  hasLpExposure: boolean;
  supportsUserFlow: boolean;
  depositToken: string | null;
  totalUserSharesRaw: string | null;
  hasOpenLpPosition: boolean | null;
}

interface EndpointSnapshot {
  url: string;
  httpStatus: number;
  healthy: boolean | null;
  ready: boolean | null;
  reason: string | null;
  runtime: Record<string, unknown> | null;
  stateCounts: {
    snapshots: number | null;
    decisions: number | null;
    tweets: number | null;
  };
}

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)"
]);

const VAULT_USER_FLOW_ABI = parseAbi([
  "function depositToken() view returns (address)",
  "function totalUserShares() view returns (uint256)",
  "function hasOpenLpPosition() view returns (bool)"
]);

function getRequiredAddress(name: string): Address {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (!isAddress(raw)) {
    throw new Error(`Invalid address in ${name}: ${raw}`);
  }
  return raw as Address;
}

function getOptionalUrl(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function getAuthToken(): string {
  return (
    process.env.MIGRATION_BOT_STATE_AUTH_TOKEN?.trim() ||
    process.env.BOT_STATE_AUTH_TOKEN?.trim() ||
    ""
  );
}

function getUsdcDecimals(): number {
  const raw = process.env.USDC_DECIMALS?.trim();
  const parsed = raw ? Number(raw) : 6;
  if (!Number.isFinite(parsed) || parsed < 0) return 6;
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asArrayLength(
  value: Record<string, unknown> | null,
  key: string
): number | null {
  if (!value) return null;
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.length : null;
}

function pushCheck(
  checks: CheckRow[],
  id: string,
  status: CheckStatus,
  detail: string
): void {
  checks.push({ id, status, detail });
}

async function readVaultSnapshot(input: {
  client: ReturnType<typeof createPublicClient>;
  vaultAddress: Address;
  usdcDecimals: number;
}): Promise<VaultSnapshot> {
  const { client, vaultAddress, usdcDecimals } = input;

  const usdcBalance = await client.readContract({
    address: TOKENS.USDC,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [vaultAddress]
  });

  const poolLpBalances = await Promise.all(
    POOLS.map(async (pool) => {
      const balance = await client.readContract({
        address: pool.lpToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [vaultAddress]
      });
      return {
        poolId: pool.id,
        lpToken: pool.lpToken,
        balanceRaw: balance.toString(),
        balanceFormatted: formatUnits(balance, usdcDecimals)
      };
    })
  );

  let depositToken: string | null = null;
  let totalUserSharesRaw: string | null = null;
  let hasOpenLpPosition: boolean | null = null;
  let supportsUserFlow = false;

  try {
    const value = await client.readContract({
      address: vaultAddress,
      abi: VAULT_USER_FLOW_ABI,
      functionName: "depositToken"
    });
    depositToken = value;
    supportsUserFlow = true;
  } catch {
    supportsUserFlow = false;
  }

  try {
    const shares = await client.readContract({
      address: vaultAddress,
      abi: VAULT_USER_FLOW_ABI,
      functionName: "totalUserShares"
    });
    totalUserSharesRaw = shares.toString();
  } catch {
    totalUserSharesRaw = null;
  }

  try {
    const open = await client.readContract({
      address: vaultAddress,
      abi: VAULT_USER_FLOW_ABI,
      functionName: "hasOpenLpPosition"
    });
    hasOpenLpPosition = open;
  } catch {
    hasOpenLpPosition = null;
  }

  const hasLpExposure = poolLpBalances.some((row) => BigInt(row.balanceRaw) > 0n);

  return {
    address: vaultAddress,
    usdcBalanceRaw: usdcBalance.toString(),
    usdcBalanceFormatted: formatUnits(usdcBalance, usdcDecimals),
    poolLpBalances,
    hasLpExposure,
    supportsUserFlow,
    depositToken,
    totalUserSharesRaw,
    hasOpenLpPosition
  };
}

async function readStateEndpoint(input: {
  url: string;
  authToken: string;
}): Promise<EndpointSnapshot> {
  const headers = input.authToken
    ? {
        "x-bot-status-token": input.authToken
      }
    : undefined;
  const response = await fetch(input.url, {
    headers,
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const obj = isRecord(payload) ? payload : null;
  const stateObj =
    obj && isRecord(obj.state) ? (obj.state as Record<string, unknown>) : null;
  const runtimeObj =
    obj && isRecord(obj.runtime) ? (obj.runtime as Record<string, unknown>) : null;

  return {
    url: input.url,
    httpStatus: response.status,
    healthy: obj && typeof obj.healthy === "boolean" ? obj.healthy : null,
    ready: obj && typeof obj.ready === "boolean" ? obj.ready : null,
    reason: obj && typeof obj.reason === "string" ? obj.reason : null,
    runtime: runtimeObj,
    stateCounts: {
      snapshots: asArrayLength(stateObj, "snapshots"),
      decisions: asArrayLength(stateObj, "decisions"),
      tweets: asArrayLength(stateObj, "tweets")
    }
  };
}

async function main(): Promise<void> {
  const checks: CheckRow[] = [];
  const usdcDecimals = getUsdcDecimals();
  const oldVault = getRequiredAddress("MIGRATION_OLD_VAULT_ADDRESS");
  const newVault = getRequiredAddress("MIGRATION_NEW_VAULT_ADDRESS");
  const oldStateUrl = getOptionalUrl("MIGRATION_OLD_BOT_STATE_URL");
  const newStateUrl = getOptionalUrl("MIGRATION_NEW_BOT_STATE_URL");
  const authToken = getAuthToken();

  const client = createPublicClient({
    transport: http(RUNTIME.rpcUrl)
  });

  const [oldSnapshot, newSnapshot, oldEndpoint, newEndpoint] = await Promise.all([
    readVaultSnapshot({ client, vaultAddress: oldVault, usdcDecimals }),
    readVaultSnapshot({ client, vaultAddress: newVault, usdcDecimals }),
    oldStateUrl ? readStateEndpoint({ url: oldStateUrl, authToken }) : Promise.resolve(null),
    newStateUrl ? readStateEndpoint({ url: newStateUrl, authToken }) : Promise.resolve(null)
  ]);

  pushCheck(
    checks,
    "old_vault.lp_drained",
    oldSnapshot.hasLpExposure ? "FAIL" : "PASS",
    oldSnapshot.hasLpExposure
      ? "Old vault still has LP exposure. Exit to USDC before cutover."
      : "Old vault LP balances are zero."
  );
  pushCheck(
    checks,
    "new_vault.user_flow",
    newSnapshot.supportsUserFlow ? "PASS" : "FAIL",
    newSnapshot.supportsUserFlow
      ? "New vault exposes user deposit/withdraw flow."
      : "New vault does not expose v2 user flow functions."
  );
  pushCheck(
    checks,
    "new_vault.deposit_token",
    newSnapshot.depositToken?.toLowerCase() === TOKENS.USDC.toLowerCase()
      ? "PASS"
      : "WARN",
    `newVault.depositToken=${newSnapshot.depositToken ?? "n/a"} expected=${TOKENS.USDC}`
  );
  if (newEndpoint) {
    const isReady =
      newEndpoint.httpStatus === 200 &&
      newEndpoint.healthy === true &&
      newEndpoint.ready === true;
    pushCheck(
      checks,
      "railway.new_service_ready",
      isReady ? "PASS" : "FAIL",
      `status=${newEndpoint.httpStatus}, healthy=${newEndpoint.healthy}, ready=${newEndpoint.ready}, reason=${newEndpoint.reason ?? "n/a"}`
    );
  } else {
    pushCheck(
      checks,
      "railway.new_service_ready",
      "WARN",
      "MIGRATION_NEW_BOT_STATE_URL not set; readiness could not be verified."
    );
  }

  if (oldEndpoint) {
    const reachable = oldEndpoint.httpStatus >= 200 && oldEndpoint.httpStatus < 500;
    pushCheck(
      checks,
      "railway.old_service_reachable",
      reachable ? "PASS" : "WARN",
      `status=${oldEndpoint.httpStatus}, healthy=${oldEndpoint.healthy}, ready=${oldEndpoint.ready}`
    );
  } else {
    pushCheck(
      checks,
      "railway.old_service_reachable",
      "WARN",
      "MIGRATION_OLD_BOT_STATE_URL not set; rollback endpoint was not checked."
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chainId: RUNTIME.chainId,
    rpcUrl: RUNTIME.rpcUrl,
    oldVault: oldSnapshot,
    newVault: newSnapshot,
    oldService: oldEndpoint,
    newService: newEndpoint,
    checks
  };

  const outputPath = process.env.MIGRATION_REPORT_PATH?.trim() || "";
  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log("=== Sentryield Migration Report ===");
  console.log(`old vault: ${oldSnapshot.address}`);
  console.log(
    `  usdc: ${oldSnapshot.usdcBalanceFormatted} (${oldSnapshot.usdcBalanceRaw} raw)`
  );
  for (const row of oldSnapshot.poolLpBalances) {
    console.log(
      `  lp[${row.poolId}]: ${row.balanceFormatted} (${row.balanceRaw} raw) token=${row.lpToken}`
    );
  }
  console.log(`new vault: ${newSnapshot.address}`);
  console.log(
    `  usdc: ${newSnapshot.usdcBalanceFormatted} (${newSnapshot.usdcBalanceRaw} raw)`
  );
  console.log(
    `  userFlow: ${newSnapshot.supportsUserFlow} totalUserShares=${newSnapshot.totalUserSharesRaw ?? "n/a"}`
  );

  for (const check of checks) {
    console.log(`${check.status.padEnd(4)} | ${check.id} | ${check.detail}`);
  }

  if (outputPath) {
    console.log(`Report written to: ${outputPath}`);
  }

  console.log("JSON_REPORT_START");
  console.log(JSON.stringify(report, null, 2));
  console.log("JSON_REPORT_END");

  const hasFailure = checks.some((row) => row.status === "FAIL");
  if (hasFailure) {
    process.exitCode = 1;
  }
}

void main();
