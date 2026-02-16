const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export interface PriceOracle {
  getPriceUsd(symbol: string): Promise<number>;
  getStablePricesUsd(): Promise<Record<string, number>>;
}

interface LivePriceOracleConfig {
  baseUrl: string;
  stableSymbols: string[];
  coingeckoIdBySymbol: Record<string, string>;
  timeoutMs: number;
  cacheTtlMs: number;
  rateLimitCooldownMs?: number;
  staleFallbackTtlMs?: number;
  warningCooldownMs?: number;
}

interface CacheEntry {
  value: number;
  expiresAt: number;
}

export interface PriceOracleTelemetry {
  cacheFreshHits: number;
  staleFallbackHits: number;
  stableFallbackHits: number;
  networkFetchSuccesses: number;
  fetchFailures: number;
}

export class LivePriceOracle implements PriceOracle {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly rateLimitCooldownMs: number;
  private readonly staleFallbackTtlMs: number;
  private readonly warningCooldownMs: number;
  private rateLimitedUntilMs = 0;
  private readonly warningLastLoggedAt = new Map<string, number>();
  private telemetry: PriceOracleTelemetry = {
    cacheFreshHits: 0,
    staleFallbackHits: 0,
    stableFallbackHits: 0,
    networkFetchSuccesses: 0,
    fetchFailures: 0
  };

  constructor(private readonly config: LivePriceOracleConfig) {
    this.rateLimitCooldownMs = Math.max(1_000, config.rateLimitCooldownMs ?? 300_000);
    this.staleFallbackTtlMs = Math.max(
      config.cacheTtlMs,
      config.staleFallbackTtlMs ?? 300_000
    );
    this.warningCooldownMs = Math.max(0, config.warningCooldownMs ?? 300_000);
  }

  async getPriceUsd(symbol: string): Promise<number> {
    const normalized = symbol.trim().toUpperCase();
    const freshCached = this.readCachedValue(normalized, false);
    if (freshCached !== null) {
      this.telemetry.cacheFreshHits += 1;
      return freshCached;
    }

    try {
      const values = await this.fetchPrices([normalized]);
      const value = values[normalized];
      if (value === undefined) {
        throw new Error(`Live price unavailable for ${normalized}.`);
      }
      this.writeCache(normalized, value);
      this.telemetry.networkFetchSuccesses += 1;
      return value;
    } catch (error) {
      this.telemetry.fetchFailures += 1;
      const staleCached = this.readCachedValue(normalized, true);
      if (staleCached !== null) {
        this.telemetry.staleFallbackHits += 1;
        // Keep stale fallback warm to avoid hammering the API while degraded.
        this.writeCache(normalized, staleCached, this.staleFallbackTtlMs);
        this.warnWithCooldown(
          `single:${normalized}`,
          `[price-oracle] Using stale cached price for ${normalized}: ${toErrorMessage(error)}`
        );
        return staleCached;
      }
      throw error;
    }
  }

  async getStablePricesUsd(): Promise<Record<string, number>> {
    const stableSymbols = this.normalizeSymbols(this.config.stableSymbols);
    const freshCached = this.readCachedSnapshot(stableSymbols, false);
    if (freshCached) {
      this.telemetry.cacheFreshHits += 1;
      return freshCached;
    }

    try {
      const values = await this.fetchPrices(stableSymbols);
      this.writeCacheSnapshot(values);
      this.telemetry.networkFetchSuccesses += 1;
      return values;
    } catch (error) {
      this.telemetry.fetchFailures += 1;
      const fallback = this.readCachedSnapshot(stableSymbols, true);
      if (fallback) {
        this.telemetry.stableFallbackHits += 1;
        this.writeCacheSnapshot(fallback, this.staleFallbackTtlMs);
        this.warnWithCooldown(
          "stable:fallback",
          `[price-oracle] Using stale cached stable prices: ${toErrorMessage(error)}`
        );
        return fallback;
      }

      const hardFallback = Object.fromEntries(stableSymbols.map((symbol) => [symbol, 1]));
      this.telemetry.stableFallbackHits += 1;
      this.writeCacheSnapshot(hardFallback, this.staleFallbackTtlMs);
      this.warnWithCooldown(
        "stable:hard-fallback",
        `[price-oracle] Falling back to $1.00 stable prices (no cache): ${toErrorMessage(error)}`
      );
      return hardFallback;
    }
  }

  getTelemetrySnapshot(): PriceOracleTelemetry {
    return {
      ...this.telemetry
    };
  }

  private async fetchPrices(symbols: string[]): Promise<Record<string, number>> {
    const uniqueSymbols = [...new Set(symbols.map((value) => value.trim().toUpperCase()))];
    if (!uniqueSymbols.length) {
      throw new Error("Price fetch requested with empty symbol set.");
    }

    const nowMs = Date.now();
    if (nowMs < this.rateLimitedUntilMs) {
      const waitSeconds = Math.max(1, Math.ceil((this.rateLimitedUntilMs - nowMs) / 1000));
      throw new Error(`CoinGecko rate-limit cooldown active (${waitSeconds}s remaining).`);
    }

    const ids = uniqueSymbols.map((symbol) => {
      const id = this.config.coingeckoIdBySymbol[symbol];
      if (!id) {
        throw new Error(`Missing CoinGecko id mapping for symbol: ${symbol}`);
      }
      return id;
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/simple/price?ids=${encodeURIComponent(
        ids.join(",")
      )}&vs_currencies=usd`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) {
        if (response.status === 429) {
          this.rateLimitedUntilMs = Date.now() + this.rateLimitCooldownMs;
        }
        throw new Error(`CoinGecko returned ${response.status}`);
      }

      const payload = (await response.json()) as Record<
        string,
        {
          usd?: number;
        }
      >;
      const result: Record<string, number> = {};
      for (let index = 0; index < uniqueSymbols.length; index += 1) {
        const symbol = uniqueSymbols[index];
        const id = ids[index];
        const value = payload[id]?.usd;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid CoinGecko USD price for ${symbol} (${id}).`);
        }
        result[symbol] = value;
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeSymbols(symbols: string[]): string[] {
    return [...new Set(symbols.map((value) => value.trim().toUpperCase()))];
  }

  private writeCache(symbol: string, value: number, ttlMs = this.config.cacheTtlMs): void {
    const normalized = symbol.trim().toUpperCase();
    const now = Date.now();
    this.cache.set(normalized, {
      value,
      expiresAt: now + ttlMs
    });
  }

  private readCachedValue(symbol: string, allowStale: boolean): number | null {
    const normalized = symbol.trim().toUpperCase();
    const cached = this.cache.get(normalized);
    if (!cached) return null;
    if (!allowStale && cached.expiresAt <= Date.now()) return null;
    return cached.value;
  }

  private readCachedSnapshot(
    symbols: string[],
    allowStale: boolean
  ): Record<string, number> | null {
    const result: Record<string, number> = {};
    for (const symbol of symbols) {
      const value = this.readCachedValue(symbol, allowStale);
      if (value === null) return null;
      result[symbol] = value;
    }
    return result;
  }

  private writeCacheSnapshot(
    values: Record<string, number>,
    ttlMs = this.config.cacheTtlMs
  ): void {
    for (const [symbol, value] of Object.entries(values)) {
      this.writeCache(symbol, value, ttlMs);
    }
  }

  private warnWithCooldown(key: string, message: string): void {
    if (this.warningCooldownMs <= 0) {
      console.warn(message);
      return;
    }
    const nowMs = Date.now();
    const lastLoggedAt = this.warningLastLoggedAt.get(key) ?? 0;
    if (nowMs - lastLoggedAt < this.warningCooldownMs) {
      return;
    }
    this.warningLastLoggedAt.set(key, nowMs);
    console.warn(message);
  }
}

export function computeIncentiveAprBps(
  rewardRatePerSecond: number,
  rewardTokenPriceUsd: number,
  tvlUsd: number
): number {
  if (tvlUsd <= 0) return 0;
  const annualRewardsUsd = rewardRatePerSecond * SECONDS_PER_YEAR * rewardTokenPriceUsd;
  return Math.max(0, Math.round((annualRewardsUsd / tvlUsd) * 10_000));
}

export function computeNetApyBps(
  baseApyBps: number,
  incentiveAprBps: number,
  protocolFeeBps: number
): number {
  return Math.max(0, baseApyBps + incentiveAprBps - protocolFeeBps);
}

export function estimatePaybackHours(costBps: number, deltaApyBps: number): number {
  if (deltaApyBps <= 0) return Number.POSITIVE_INFINITY;
  return (costBps / deltaApyBps) * 365 * 24;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown_error";
}
