/**
 * Circuit Breaker middleware for database and external service failures.
 * 
 * Implements the circuit breaker pattern to prevent cascading failures when
 * downstream services (e.g., database, blockchain) are experiencing issues.
 * 
 * States:
 *   - CLOSED: Normal operation, all requests pass through
 *   - OPEN: Service is failing, reject requests immediately with 503
 *   - HALF_OPEN: Testing if service has recovered, allow one request through
 * 
 * Configuration (via environment variables):
 *   - CIRCUIT_BREAKER_THRESHOLD: Error rate threshold to open circuit (0-1, default: 0.5)
 *   - CIRCUIT_BREAKER_DURATION: Time in ms to keep circuit open (default: 10000)
 *   - CIRCUIT_BREAKER_SAMPLE_SIZE: Number of requests to track (default: 20)
 */

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";

enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

interface CircuitBreakerConfig {
  /** Error rate threshold to open circuit (0-1). Default: 0.5 (50%) */
  threshold: number;
  /** Duration in milliseconds to keep circuit open. Default: 10000ms (10s) */
  duration: number;
  /** Number of recent requests to track for error rate calculation. Default: 20 */
  sampleSize: number;
}

interface CircuitMetrics {
  successes: number;
  failures: number;
  lastFailureTime: number | null;
  state: CircuitState;
  stateChangedAt: number;
}

class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private metrics: CircuitMetrics;
  private recentResults: boolean[]; // true = success, false = failure

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      threshold: parseFloat(process.env.CIRCUIT_BREAKER_THRESHOLD || "0.5"),
      duration: parseInt(process.env.CIRCUIT_BREAKER_DURATION || "10000", 10),
      sampleSize: parseInt(process.env.CIRCUIT_BREAKER_SAMPLE_SIZE || "20", 10),
      ...config,
    };

    this.metrics = {
      successes: 0,
      failures: 0,
      lastFailureTime: null,
      state: CircuitState.CLOSED,
      stateChangedAt: Date.now(),
    };

    this.recentResults = [];
  }

  /**
   * Check if the circuit allows the request to proceed.
   * Returns true if request should be allowed, false otherwise.
   */
  public allowRequest(): boolean {
    const now = Date.now();

    switch (this.metrics.state) {
      case CircuitState.CLOSED:
        // Normal operation - allow all requests
        return true;

      case CircuitState.OPEN:
        // Check if enough time has passed to attempt recovery
        const timeSinceOpen = now - this.metrics.stateChangedAt;
        if (timeSinceOpen >= this.config.duration) {
          this.transitionTo(CircuitState.HALF_OPEN);
          logger.info("circuit_breaker_half_open", {
            duration: timeSinceOpen,
            previousFailures: this.metrics.failures,
          });
          return true; // Allow one test request
        }
        return false; // Still in open state, reject

      case CircuitState.HALF_OPEN:
        // Only allow one request through to test service health
        // Additional requests are rejected until the test completes
        return false;

      default:
        return true;
    }
  }

  /**
   * Record a successful operation.
   */
  public recordSuccess(): void {
    this.metrics.successes++;
    this.recentResults.push(true);
    this.trimResults();

    if (this.metrics.state === CircuitState.HALF_OPEN) {
      // Test request succeeded - close the circuit
      this.transitionTo(CircuitState.CLOSED);
      logger.info("circuit_breaker_closed", {
        successRate: this.calculateSuccessRate(),
      });
    } else if (this.metrics.state === CircuitState.OPEN) {
      // Shouldn't happen but handle gracefully
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  /**
   * Record a failed operation.
   */
  public recordFailure(): void {
    this.metrics.failures++;
    this.metrics.lastFailureTime = Date.now();
    this.recentResults.push(false);
    this.trimResults();

    if (this.metrics.state === CircuitState.HALF_OPEN) {
      // Test request failed - reopen the circuit
      this.transitionTo(CircuitState.OPEN);
      logger.warn("circuit_breaker_reopened", {
        reason: "test_request_failed",
      });
      return;
    }

    if (this.metrics.state === CircuitState.CLOSED) {
      const errorRate = this.calculateErrorRate();
      if (errorRate >= this.config.threshold) {
        this.transitionTo(CircuitState.OPEN);
        logger.error("circuit_breaker_opened", {
          errorRate,
          threshold: this.config.threshold,
          recentFailures: this.recentResults.filter((r) => !r).length,
          sampleSize: this.recentResults.length,
        });
      }
    }
  }

  /**
   * Get current circuit state and metrics.
   */
  public getMetrics(): CircuitMetrics {
    return {
      ...this.metrics,
      state: this.metrics.state,
    };
  }

  /**
   * Reset the circuit breaker (useful for testing).
   */
  public reset(): void {
    this.metrics = {
      successes: 0,
      failures: 0,
      lastFailureTime: null,
      state: CircuitState.CLOSED,
      stateChangedAt: Date.now(),
    };
    this.recentResults = [];
    logger.info("circuit_breaker_reset");
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.metrics.state;
    this.metrics.state = newState;
    this.metrics.stateChangedAt = Date.now();

    if (oldState !== newState) {
      logger.info("circuit_breaker_state_transition", {
        from: oldState,
        to: newState,
      });
    }
  }

  private calculateErrorRate(): number {
    if (this.recentResults.length === 0) return 0;
    const failures = this.recentResults.filter((r) => !r).length;
    return failures / this.recentResults.length;
  }

  private calculateSuccessRate(): number {
    if (this.recentResults.length === 0) return 1;
    const successes = this.recentResults.filter((r) => r).length;
    return successes / this.recentResults.length;
  }

  private trimResults(): void {
    if (this.recentResults.length > this.config.sampleSize) {
      this.recentResults = this.recentResults.slice(-this.config.sampleSize);
    }
  }
}

// Global circuit breaker instance for database operations
const dbCircuitBreaker = new CircuitBreaker();

// Global circuit breaker instance for blockchain operations (more lenient)
const blockchainCircuitBreaker = new CircuitBreaker({
  threshold: 0.7, // Higher threshold since blockchain can be slower
  duration: 30000, // 30 seconds
  sampleSize: 10,
});

/**
 * Middleware that checks the database circuit breaker before allowing requests.
 * Returns 503 Service Unavailable if circuit is open.
 */
export function dbCircuitBreakerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!dbCircuitBreaker.allowRequest()) {
    const metrics = dbCircuitBreaker.getMetrics();
    const retryAfter = Math.ceil(
      (metrics.stateChangedAt + 
        parseInt(process.env.CIRCUIT_BREAKER_DURATION || "10000", 10) - 
        Date.now()) / 1000
    );

    res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
    
    const error = new AppError(
      "Service temporarily unavailable due to high error rate. Please try again later.",
      503,
      "SERVICE_UNAVAILABLE",
    );
    
    return next(error);
  }

  next();
}

/**
 * Wrap async database operations to record success/failure in circuit breaker.
 */
export function circuitBreakerMiddleware(
  breaker: CircuitBreaker,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.VOTE_CIRCUIT_TIMEOUT_MS || 1000);
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!breaker.allowRequest()) {
      const metrics = breaker.getMetrics();
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((metrics.stateChangedAt + Number(process.env.VOTE_CIRCUIT_BREAKER_DURATION_MS || 30000) - Date.now()) / 1000))));
      res.status(503).json({ error: { code: "CIRCUIT_OPEN", message: "Vote submission is temporarily unavailable." } });
      return;
    }
    const startedAt = Date.now();
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        breaker.recordFailure();
        res.setHeader("Retry-After", "1");
        if (!res.headersSent) res.status(503).json({ error: { code: "UPSTREAM_TIMEOUT", message: "Vote submission timed out; please retry." } });
      }
    }, timeoutMs);
    res.once("finish", () => {
      settled = true;
      clearTimeout(timer);
      const failed = res.statusCode >= 500 || res.statusCode === 429;
      if (!timedOut && (failed || Date.now() - startedAt > timeoutMs)) breaker.recordFailure(); else if (!timedOut) breaker.recordSuccess();
    });
    next();
  };
}

export const voteCircuitBreaker = new CircuitBreaker({
  threshold: Number(process.env.VOTE_CIRCUIT_BREAKER_THRESHOLD || 0.05),
  duration: Number(process.env.VOTE_CIRCUIT_BREAKER_DURATION_MS || 30000),
  sampleSize: Number(process.env.VOTE_CIRCUIT_BREAKER_SAMPLE_SIZE || 20),
});

export async function executeWithCircuitBreaker<T>(
  operation: () => Promise<T>,
  breaker: CircuitBreaker = dbCircuitBreaker,
): Promise<T> {
  try {
    const result = await operation();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

export {
  CircuitBreaker,
  CircuitState,
  dbCircuitBreaker,
  blockchainCircuitBreaker,
};
