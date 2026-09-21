/**
 * CircuitBreaker — per-connector fault isolation.
 *
 * State machine:
 *   CLOSED     → normal operation, counting failures
 *   OPEN       → all calls fail-fast (no timeout wasted)
 *   HALF_OPEN  → one probe call allowed; success → CLOSED, failure → OPEN
 *
 * Prevents cascading failures when a downstream server is degraded.
 * Each connector gets its own independent breaker.
 */

import { createLogger } from '../observability/logging.js';

const logger = createLogger('circuit-breaker');

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerConfig {
  /** Number of failures in the window before opening */
  failureThreshold: number;
  /** Rolling window in ms — failures older than this don't count */
  windowMs: number;
  /** Time to wait in OPEN before probing (half-open) */
  probeIntervalMs: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  probeIntervalMs: 30_000
};

export interface BreakerSnapshot {
  state: BreakerState;
  failureCount: number;
  lastFailureAt?: Date;
  lastStateChangeAt: Date;
  totalTrips: number;
}

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failureTimes: number[] = [];
  private openedAt?: number;
  private lastStateChangeAt = new Date();
  private totalTrips = 0;
  private probeInFlight = false;

  constructor(
    private readonly serverId: string,
    private readonly config: BreakerConfig = DEFAULT_BREAKER_CONFIG
  ) {}

  /**
   * Check if a call is allowed.
   * Throws BreakerOpenError if in OPEN state and probe interval hasn't elapsed.
   * Returns 'probe' if this call should be treated as a half-open probe.
   */
  allowCall(): 'allowed' | 'probe' {
    this.pruneOldFailures();

    switch (this.state) {
      case 'CLOSED':
        return 'allowed';

      case 'OPEN': {
        const elapsed = Date.now() - (this.openedAt ?? 0);
        if (elapsed >= this.config.probeIntervalMs && !this.probeInFlight) {
          this.transitionTo('HALF_OPEN');
          this.probeInFlight = true;
          return 'probe';
        }
        throw new BreakerOpenError(
          this.serverId,
          Math.max(0, this.config.probeIntervalMs - elapsed)
        );
      }

      case 'HALF_OPEN':
        // Only one probe at a time — all other calls fail-fast
        if (!this.probeInFlight) {
          this.probeInFlight = true;
          return 'probe';
        }
        throw new BreakerOpenError(this.serverId, this.config.probeIntervalMs);
    }
  }

  /** Record a successful call outcome */
  recordSuccess(): void {
    this.probeInFlight = false;
    if (this.state === 'HALF_OPEN') {
      logger.info({ serverId: this.serverId }, 'Circuit breaker probe succeeded — closing');
      this.failureTimes = [];
      this.transitionTo('CLOSED');
    }
  }

  /** Record a failed call outcome */
  recordFailure(): void {
    this.probeInFlight = false;
    const now = Date.now();
    this.failureTimes.push(now);
    this.pruneOldFailures();

    if (this.state === 'HALF_OPEN') {
      logger.warn({ serverId: this.serverId }, 'Circuit breaker probe failed — reopening');
      this.trip(now);
      return;
    }

    if (this.state === 'CLOSED' && this.failureTimes.length >= this.config.failureThreshold) {
      logger.warn(
        { serverId: this.serverId, failures: this.failureTimes.length },
        'Circuit breaker tripped — opening'
      );
      this.trip(now);
    }
  }

  get snapshot(): BreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureTimes.length,
      lastFailureAt: this.failureTimes.length > 0
        ? new Date(this.failureTimes[this.failureTimes.length - 1]!)
        : undefined,
      lastStateChangeAt: this.lastStateChangeAt,
      totalTrips: this.totalTrips
    };
  }

  get currentState(): BreakerState {
    return this.state;
  }

  private trip(now: number): void {
    this.openedAt = now;
    this.totalTrips++;
    this.transitionTo('OPEN');
  }

  private transitionTo(newState: BreakerState): void {
    this.state = newState;
    this.lastStateChangeAt = new Date();
  }

  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.windowMs;
    this.failureTimes = this.failureTimes.filter((t) => t >= cutoff);
  }
}

export class BreakerOpenError extends Error {
  constructor(
    public readonly serverId: string,
    public readonly retryAfterMs: number
  ) {
    super(
      `Circuit breaker OPEN for server "${serverId}". ` +
      `Retry in ${Math.round(retryAfterMs / 1000)}s.`
    );
    this.name = 'BreakerOpenError';
  }
}

/** Registry of all circuit breakers — one per server */
export class CircuitBreakerRegistry {
  private readonly _breakers = new Map<string, CircuitBreaker>();

  getOrCreate(serverId: string, config?: BreakerConfig): CircuitBreaker {
    let breaker = this._breakers.get(serverId);
    if (!breaker) {
      breaker = new CircuitBreaker(serverId, config);
      this._breakers.set(serverId, breaker);
    }
    return breaker;
  }

  get(serverId: string): CircuitBreaker | undefined {
    return this._breakers.get(serverId);
  }

  allSnapshots(): Record<string, BreakerSnapshot> {
    const result: Record<string, BreakerSnapshot> = {};
    for (const [id, breaker] of this._breakers.entries()) {
      result[id] = breaker.snapshot;
    }
    return result;
  }
}
