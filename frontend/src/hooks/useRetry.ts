import { useCallback, useRef } from "react";

// Delays in ms for each retry attempt
const NETWORK_DELAYS = [1000, 3000, 10000] as const;
const SERVER_DELAYS = [5000, 15000, 30000] as const;

export type RetryCategory = "network" | "server" | "client" | "auth";

export function categoriseError(err: unknown): RetryCategory {
  const e = err as { response?: { status?: number } };
  if (!e?.response) return "network";
  const status = e.response.status ?? 0;
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "client";
}

interface RetryState {
  attempt: number;
  retrying: boolean;
  nextDelay: number | null;
}

interface UseRetryOptions {
  onRetry?: (attempt: number, delayMs: number) => void;
  onGiveUp?: () => void;
}

export function useRetry(options: UseRetryOptions = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<RetryState>({ attempt: 0, retrying: false, nextDelay: null });

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stateRef.current = { attempt: 0, retrying: false, nextDelay: null };
  }, []);

  // Schedules a retry for `fn`. Returns true if a retry was scheduled.
  // Returns false if the error category is not retryable or max attempts reached.
  const scheduleRetry = useCallback(
    (category: RetryCategory, fn: () => Promise<void>): boolean => {
      if (category === "client" || category === "auth") return false;

      const delays = category === "network" ? NETWORK_DELAYS : SERVER_DELAYS;
      const attempt = stateRef.current.attempt;

      if (attempt >= delays.length) {
        stateRef.current.retrying = false;
        options.onGiveUp?.();
        return false;
      }

      const delay = delays[attempt];
      stateRef.current.attempt += 1;
      stateRef.current.retrying = true;
      stateRef.current.nextDelay = delay;

      options.onRetry?.(stateRef.current.attempt, delay);

      timerRef.current = setTimeout(async () => {
        try {
          await fn();
          stateRef.current = { attempt: 0, retrying: false, nextDelay: null };
        } catch (err) {
          const cat = categoriseError(err);
          scheduleRetry(cat, fn);
        }
      }, delay);

      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.onRetry, options.onGiveUp],
  );

  return { scheduleRetry, cancel, state: stateRef.current };
}
