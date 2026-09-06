import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFormPersistence } from "../hooks/useFormPersistence";

// Mock storage-crypto so tests are deterministic and don't need Web Crypto.
// encryptJSON  → JSON.stringify  (plaintext storage in tests)
// decryptJSON  → JSON.parse      (plaintext read in tests)
vi.mock("../utils/storage-crypto", () => ({
  getOrCreateSessionKey: vi.fn().mockResolvedValue({}),
  encryptJSON: vi.fn().mockImplementation(async (data: unknown) =>
    JSON.stringify(data),
  ),
  decryptJSON: vi.fn().mockImplementation(async (encoded: string) =>
    JSON.parse(encoded),
  ),
}));

// ── localStorage stub ─────────────────────────────────────────────────────────
// jsdom's localStorage.clear may be missing depending on vitest/jsdom version.
// Use a self-contained in-memory stub so tests are environment-independent.

const localStorageStore: Map<string, string> = new Map();

const localStorageStub = {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageStore.set(key, value),
  removeItem: (key: string) => localStorageStore.delete(key),
  clear: () => localStorageStore.clear(),
  get length() { return localStorageStore.size; },
  key: (i: number) => [...localStorageStore.keys()][i] ?? null,
};

vi.stubGlobal("localStorage", localStorageStub);

// ─────────────────────────────────────────────────────────────────────────────

const BALLOT_ID = "ballot-persist-test";
const KEY = `anonvote-vote-form_${BALLOT_ID}`;

beforeEach(() => {
  localStorageStore.clear();
});

afterEach(() => {
  localStorageStore.clear();
});

describe("useFormPersistence", () => {
  it("returns null savedDraft when localStorage is empty", () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    expect(result.current.savedDraft).toBeNull();
  });

  it("persist() writes form state to localStorage", async () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    await act(async () => {
      await result.current.persist({ token: "abc123", selectedOption: "opt-1" });
    });

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.token).toBe("abc123");
    expect(stored.selectedOption).toBe("opt-1");
  });

  it("loads a saved draft from localStorage on mount", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "saved-token", selectedOption: "opt-2" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    await waitFor(() => expect(result.current.savedDraft).not.toBeNull());
    expect(result.current.savedDraft?.token).toBe("saved-token");
    expect(result.current.savedDraft?.selectedOption).toBe("opt-2");
  });

  it("does not load a draft if both fields are empty strings", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "", selectedOption: "" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    await waitFor(() => expect(result.current.savedDraft).toBeNull());
  });

  it("does not load corrupt JSON from localStorage", async () => {
    localStorage.setItem(KEY, "NOT_JSON{{{");

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(result.current.savedDraft).toBeNull();
  });

  it("restoreDraft() returns the draft and clears savedDraft", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "restore-me", selectedOption: "opt-3" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    await waitFor(() => expect(result.current.savedDraft).not.toBeNull());

    let draft: ReturnType<typeof result.current.restoreDraft>;
    act(() => {
      draft = result.current.restoreDraft();
    });

    expect(draft?.token).toBe("restore-me");
    expect(result.current.savedDraft).toBeNull();
  });

  it("dismissDraft() clears savedDraft without returning the data", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "dismiss-me", selectedOption: "" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    await waitFor(() => expect(result.current.savedDraft).not.toBeNull());

    act(() => {
      result.current.dismissDraft();
    });

    expect(result.current.savedDraft).toBeNull();
  });

  it("clearPersisted() removes the key from localStorage", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "clear-me", selectedOption: "opt-1" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    await waitFor(() => expect(result.current.savedDraft).not.toBeNull());

    act(() => {
      result.current.clearPersisted();
    });

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.savedDraft).toBeNull();
  });

  it("persist() does not write to localStorage when both fields are empty", async () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    await act(async () => {
      await result.current.persist({ token: "", selectedOption: "" });
    });

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("works correctly when ballotId is undefined", async () => {
    const { result } = renderHook(() => useFormPersistence(undefined));
    expect(result.current.savedDraft).toBeNull();

    await act(async () => {
      await result.current.persist({ token: "x", selectedOption: "y" });
    });
    expect(localStorage.length).toBe(0);
  });
});
