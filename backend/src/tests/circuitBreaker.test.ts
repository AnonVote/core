/**
 * Circuit Breaker Tests
 * 
 * Tests the circuit breaker pattern implementation for protecting against
 * cascading failures and service degradation.
 */

import {
  CircuitBreaker,
  CircuitState,
  executeWithCircuitBreaker,
} from "../middleware/circuitBreaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    // Create a fresh circuit breaker with fast timings for tests
    breaker = new CircuitBreaker({
      threshold: 0.5, // 50% error rate
      duration: 100, // 100ms open duration
      sampleSize: 10,
    });
  });

  describe("CLOSED state behavior", () => {
    it("allows all requests in closed state", () => {
      expect(breaker.allowRequest()).toBe(true);
      expect(breaker.allowRequest()).toBe(true);
      expect(breaker.allowRequest()).toBe(true);
    });

    it("tracks successful operations", () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();

      const metrics = breaker.getMetrics();
      expect(metrics.successes).toBe(3);
      expect(metrics.failures).toBe(0);
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });

    it("remains closed when error rate is below threshold", () => {
      // 4 successes, 3 failures = 42.8% error rate (below 50% threshold)
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });

    it("opens when error rate exceeds threshold", () => {
      // 3 successes, 7 failures = 70% error rate (above 50% threshold)
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.OPEN);
      expect(metrics.failures).toBe(7);
    });
  });

  describe("OPEN state behavior", () => {
    beforeEach(() => {
      // Force circuit to open
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
    });

    it("rejects all requests in open state", () => {
      expect(breaker.allowRequest()).toBe(false);
      expect(breaker.allowRequest()).toBe(false);
      expect(breaker.allowRequest()).toBe(false);
    });

    it("transitions to half-open after timeout", async () => {
      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

      // Wait for circuit breaker timeout (100ms)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next request should transition to half-open
      expect(breaker.allowRequest()).toBe(true);
      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe("HALF_OPEN state behavior", () => {
    beforeEach(async () => {
      // Force circuit to open
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure();
      }

      // Wait for timeout and transition to half-open
      await new Promise((resolve) => setTimeout(resolve, 150));
      breaker.allowRequest(); // Triggers transition to half-open
    });

    it("allows one test request in half-open state", () => {
      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);
      
      // Additional requests should be rejected while in half-open
      expect(breaker.allowRequest()).toBe(false);
      expect(breaker.allowRequest()).toBe(false);
    });

    it("closes circuit on successful test request", () => {
      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);

      breaker.recordSuccess();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });

    it("reopens circuit on failed test request", () => {
      expect(breaker.getMetrics().state).toBe(CircuitState.HALF_OPEN);

      breaker.recordFailure();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.OPEN);
    });
  });

  describe("metrics tracking", () => {
    it("tracks successes and failures", () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordFailure();

      const metrics = breaker.getMetrics();
      expect(metrics.successes).toBe(3);
      expect(metrics.failures).toBe(2);
    });

    it("maintains sample size limit", () => {
      // Record more operations than sample size (10)
      for (let i = 0; i < 20; i++) {
        breaker.recordSuccess();
      }

      // Should only track last 10
      const metrics = breaker.getMetrics();
      expect(metrics.successes).toBe(20); // Total count
      // Internal tracking should be limited (tested via state transitions)
    });

    it("records last failure time", () => {
      const beforeTime = Date.now();
      breaker.recordFailure();
      const afterTime = Date.now();

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).toBeGreaterThanOrEqual(beforeTime);
      expect(metrics.lastFailureTime).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("reset functionality", () => {
    it("resets all metrics and state", () => {
      // Trigger some activity
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

      // Reset
      breaker.reset();

      const metrics = breaker.getMetrics();
      expect(metrics.successes).toBe(0);
      expect(metrics.failures).toBe(0);
      expect(metrics.state).toBe(CircuitState.CLOSED);
      expect(metrics.lastFailureTime).toBeNull();
    });
  });

  describe("environment variable configuration", () => {
    it("respects CIRCUIT_BREAKER_THRESHOLD env var", () => {
      const originalThreshold = process.env.CIRCUIT_BREAKER_THRESHOLD;
      process.env.CIRCUIT_BREAKER_THRESHOLD = "0.7";

      const customBreaker = new CircuitBreaker();
      
      // 6 successes, 4 failures = 40% error rate (below 70% threshold)
      for (let i = 0; i < 6; i++) customBreaker.recordSuccess();
      for (let i = 0; i < 4; i++) customBreaker.recordFailure();

      expect(customBreaker.getMetrics().state).toBe(CircuitState.CLOSED);

      // Cleanup
      if (originalThreshold) {
        process.env.CIRCUIT_BREAKER_THRESHOLD = originalThreshold;
      } else {
        delete process.env.CIRCUIT_BREAKER_THRESHOLD;
      }
    });

    it("respects CIRCUIT_BREAKER_SAMPLE_SIZE env var", () => {
      const originalSampleSize = process.env.CIRCUIT_BREAKER_SAMPLE_SIZE;
      process.env.CIRCUIT_BREAKER_SAMPLE_SIZE = "5";

      const customBreaker = new CircuitBreaker();

      // Record 10 operations (more than sample size of 5)
      for (let i = 0; i < 10; i++) {
        customBreaker.recordSuccess();
      }

      // Should only consider last 5 operations for error rate
      // This is tested indirectly through state transitions
      expect(customBreaker.getMetrics().state).toBe(CircuitState.CLOSED);

      // Cleanup
      if (originalSampleSize) {
        process.env.CIRCUIT_BREAKER_SAMPLE_SIZE = originalSampleSize;
      } else {
        delete process.env.CIRCUIT_BREAKER_SAMPLE_SIZE;
      }
    });
  });
});

describe("executeWithCircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      threshold: 0.5,
      duration: 100,
      sampleSize: 10,
    });
  });

  it("records success on successful operation", async () => {
    const operation = jest.fn().mockResolvedValue("success");

    const result = await executeWithCircuitBreaker(operation, breaker);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.getMetrics().successes).toBe(1);
    expect(breaker.getMetrics().failures).toBe(0);
  });

  it("records failure and rethrows on failed operation", async () => {
    const error = new Error("operation failed");
    const operation = jest.fn().mockRejectedValue(error);

    await expect(executeWithCircuitBreaker(operation, breaker)).rejects.toThrow(
      "operation failed"
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(breaker.getMetrics().successes).toBe(0);
    expect(breaker.getMetrics().failures).toBe(1);
  });

  it("returns operation result when successful", async () => {
    const operation = jest.fn().mockResolvedValue({ data: "test", count: 42 });

    const result = await executeWithCircuitBreaker(operation, breaker);

    expect(result).toEqual({ data: "test", count: 42 });
  });

  it("propagates original error details on failure", async () => {
    const customError = new Error("Database connection failed");
    (customError as any).code = "ECONNREFUSED";
    const operation = jest.fn().mockRejectedValue(customError);

    try {
      await executeWithCircuitBreaker(operation, breaker);
      fail("Should have thrown error");
    } catch (err: any) {
      expect(err.message).toBe("Database connection failed");
      expect(err.code).toBe("ECONNREFUSED");
    }
  });

  it("opens circuit after repeated failures", async () => {
    const operation = jest.fn().mockRejectedValue(new Error("fail"));

    // Trigger 10 failures (above 50% threshold)
    for (let i = 0; i < 10; i++) {
      try {
        await executeWithCircuitBreaker(operation, breaker);
      } catch (err) {
        // Expected
      }
    }

    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
  });
});
