import type {
  PoolConfig,
  PoolOnChainState,
  VaultEnterRequest,
  VaultExitRequest
} from "../types.js";
import type {
  BuildEnterRequestInput,
  BuildExitRequestInput,
  StrategyAdapter
} from "./adapter.interface.js";

export class Dex1Adapter implements StrategyAdapter {
  readonly id = "dex1";

  async fetchPoolState(pool: PoolConfig): Promise<PoolOnChainState> {
    void pool;
    throw new Error("Dex1Adapter is disabled in live runtime.");
  }

  async estimatePriceImpactBps(pool: PoolConfig, amountIn: bigint): Promise<number> {
    void pool;
    void amountIn;
    throw new Error("Dex1Adapter is disabled in live runtime.");
  }

  async estimateRotationCostBps(
    fromPool: PoolConfig,
    toPool: PoolConfig,
    amountIn: bigint
  ): Promise<number> {
    void fromPool;
    void toPool;
    void amountIn;
    throw new Error("Dex1Adapter is disabled in live runtime.");
  }

  async buildEnterRequest(input: BuildEnterRequestInput): Promise<VaultEnterRequest> {
    return {
      target: input.pool.target,
      pool: input.pool.pool,
      tokenIn: input.pool.tokenIn,
      lpToken: input.pool.lpToken,
      amountIn: input.amountIn,
      minOut: input.minOut,
      deadline: input.deadline,
      data: "0x",
      pair: input.pool.pair,
      protocol: input.pool.protocol,
      netApyBps: input.netApyBps,
      intendedHoldSeconds: input.intendedHoldSeconds
    };
  }

  async buildExitRequest(input: BuildExitRequestInput): Promise<VaultExitRequest> {
    return {
      target: input.pool.target,
      pool: input.pool.pool,
      lpToken: input.pool.lpToken,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
      minOut: input.minOut,
      deadline: input.deadline,
      data: "0x",
      pair: input.pool.pair,
      protocol: input.pool.protocol
    };
  }
}
