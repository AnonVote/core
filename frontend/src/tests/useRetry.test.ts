import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRetry, categoriseError } from "../hooks/useRetry";

// ── categoriseError ───────────────────────────────────────────────────────────

describe("categoriseError", () => {
  it("returns 'network' when there is no response object", () => {
    expect(categoriseError(new Error("Network Error"))).toBe("network");
    expect(categoriseError({})).toBe("network");
    expect(categoriseError(null)).toBe("network");
  });

  it("returns 'auth' for 401 responses", () => {
    expect(categoriseError({ response: { status: 401 } })).toBe("auth");
  });

  it("returns 'auth' for 403 responses", () => {
    expect(categoriseError({ response: { status: 403 } })).toBe("auth");
  });

  it("returns 'server' for 500 responses", () => {
    expect(categoriseError({ response: { status: 500 } })).toBe("server");
  });

  it("returns 'server' for 503 responses", () => {
    expect(categoriseError({ response: { status: 503 } })).toBe("server");
  });

  it("returns 'client' for 400 responses", () => {
    expect(categoriseError({ response: { status: 400 } })).toBe("client");
  });

  it("returns 'client' for 409 responses", () => {
    expect(categoriseError({ response: { status: 409 } })).toBe("client");
  });

  it("returns 'client' for 429 responses", () => {
    expect(categoriseError({ response: { status: 429 } })).toBe("client");
  });
});

// ── useRetry ──────────────────────────────────────────────────────────────────

describe("useRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not schedule a retry for client errors", () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 400 } });
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRetry({ onRetry }));

    let scheduled: boolean;
    act(() => {
      scheduled = result.current.scheduleRetry("client", fn);
    });

    expect(scheduled!).toBe(false);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("does not schedule a retry for auth errors", () => {
    const fn = vi.fn();
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRetry({ onRetry }));

    let scheduled: boolean;
    act(() => {
      scheduled = result.current.scheduleRetry("auth", fn);
    });

    expect(scheduled!).toBe(false);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("schedules a retry for network errors and calls fn after 1s", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRetry({ onRetry }));

    act(() => {
      result.current.scheduleRetry("network", fn);
    });

    expect(fn).not.toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalledWith(1, 1000);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("schedules a retry for server errors and calls fn after 5s", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    const { result } = renderHook(() => useRetry({ onRetry }));

    act(() => {
      result.current.scheduleRetry("server", fn);
    });

    expect(onRetry).toHaveBeenCalledWith(1, 5000);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onGiveUp after max retries (3) for network errors", async () => {
    const err = new Error("Network Error");
    const fn = vi.fn().mockRejectedValue(err);
    const onRetry = vi.fn();
    const onGiveUp = vi.fn();
    const { result } = renderHook(() => useRetry({ onRetry, onGiveUp }));

    // First attempt (scheduled manually)
    act(() => {
      result.current.scheduleRetry("network", fn);
    });

    // Advance through all 3 delays: 1s, 3s, 10s
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    await act(async () => { vi.advanceTimersByTime(10000); });

    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("returns true when a retry is scheduled", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRetry());

    let scheduled: boolean;
    act(() => {
      scheduled = result.current.scheduleRetry("network", fn);
    });

    expect(scheduled!).toBe(true);
  });

  it("cancel() stops the pending retry timer", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRetry());

    act(() => {
      result.current.scheduleRetry("network", fn);
    });

    act(() => {
      result.current.cancel();
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
