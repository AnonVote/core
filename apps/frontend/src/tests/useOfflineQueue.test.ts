import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineQueue } from "../hooks/useOfflineQueue";

// Mock storage-crypto so tests are deterministic and don't need Web Crypto.
// encryptJSON  → JSON.stringify  (identity)
// decryptJSON  → JSON.parse      (identity)
vi.mock("../utils/storage-crypto", () => ({
  getOrCreateSessionKey: vi.fn().mockResolvedValue({}),
  encryptJSON: vi.fn().mockImplementation(async (data: unknown) =>
    JSON.stringify(data),
  ),
  decryptJSON: vi.fn().mockImplementation(async (encoded: string) =>
    JSON.parse(encoded),
  ),
}));

// ── IndexedDB mock ────────────────────────────────────────────────────────────

const store: Map<number, object> = new Map();
let nextId = 1;

function makeRequest<T>(
  result: T,
  error?: DOMException | null,
): IDBRequest<T> {
  const req = {
    result,
    error: error ?? null,
    onsuccess: null as ((e: Event) => void) | null,
    onerror: null as ((e: Event) => void) | null,
  } as unknown as IDBRequest<T>;

  setTimeout(() => {
    if (error) {
      req.onerror?.({} as Event);
    } else {
      req.onsuccess?.({} as Event);
    }
  }, 0);

  return req;
}

const fakeObjectStore = {
  add: vi.fn((value: object) => {
    const id = nextId++;
    store.set(id, { ...value, id });
    return makeRequest(id);
  }),
  getAll: vi.fn(() => makeRequest([...store.values()])),
  delete: vi.fn((id: number) => {
    store.delete(id);
    return makeRequest(undefined);
  }),
};

const fakeTx = { objectStore: vi.fn(() => fakeObjectStore) };

const fakeDB = {
  transaction: vi.fn(() => fakeTx),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn(),
  close: vi.fn(),
};

const openRequest = {
  result: fakeDB,
  error: null,
  onsuccess: null as ((e: Event) => void) | null,
  onerror: null as ((e: Event) => void) | null,
  onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
};

vi.stubGlobal("indexedDB", {
  open: vi.fn(() => {
    setTimeout(() => openRequest.onsuccess?.({} as Event), 0);
    return openRequest;
  }),
});

// ── submitVote mock ───────────────────────────────────────────────────────────

vi.mock("../api/client", () => ({
  submitVote: vi.fn(),
}));

import { submitVote } from "../api/client";
const mockedSubmitVote = submitVote as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStoredEntry(
  id: number,
  vote: {
    ballotId: string;
    voterToken: string;
    optionId: string;
    weight?: number;
  },
) {
  // With the mocked encryptJSON, the payload is just JSON.stringify of the vote fields.
  const encryptedPayload = JSON.stringify({ ...vote, queuedAt: Date.now() });
  return { id, encryptedPayload, queuedAt: Date.now() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  nextId = 1;
  vi.clearAllMocks();
  fakeObjectStore.add.mockImplementation((value: object) => {
    const id = nextId++;
    store.set(id, { ...value, id });
    return makeRequest(id);
  });
  fakeObjectStore.getAll.mockImplementation(() =>
    makeRequest([...store.values()]),
  );
  fakeObjectStore.delete.mockImplementation((id: number) => {
    store.delete(id);
    return makeRequest(undefined);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOfflineQueue", () => {
  it("enqueue() adds an encrypted entry to the IndexedDB store", async () => {
    const { result } = renderHook(() => useOfflineQueue());

    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      await result.current.enqueue({
        ballotId: "b1",
        voterToken: "a".repeat(64),
        optionId: "opt-1",
      });
    });

    expect(fakeObjectStore.add).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    const entry = [...store.values()][0] as {
      encryptedPayload: string;
      queuedAt: number;
    };
    expect(typeof entry.encryptedPayload).toBe("string");
    expect(typeof entry.queuedAt).toBe("number");

    // With identity mock, payload is JSON — verify it contains the vote data
    const decrypted = JSON.parse(entry.encryptedPayload);
    expect(decrypted.ballotId).toBe("b1");
    expect(decrypted.voterToken).toBe("a".repeat(64));
  });

  it("syncQueue() calls submitVote for each queued vote", async () => {
    mockedSubmitVote.mockResolvedValue({ data: { data: { voteId: "v1" } } });

    store.set(
      1,
      makeStoredEntry(1, {
        ballotId: "b1",
        voterToken: "a".repeat(64),
        optionId: "opt-1",
        weight: 1,
      }),
    );

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(mockedSubmitVote).toHaveBeenCalledTimes(1);
    expect(mockedSubmitVote).toHaveBeenCalledWith(
      expect.objectContaining({ ballotId: "b1", voterToken: "a".repeat(64) }),
    );
  });

  it("syncQueue() removes a successfully submitted vote from the store", async () => {
    mockedSubmitVote.mockResolvedValue({ data: {} });

    store.set(
      1,
      makeStoredEntry(1, {
        ballotId: "b2",
        voterToken: "b".repeat(64),
        optionId: "opt-2",
        weight: 1,
      }),
    );

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(fakeObjectStore.delete).toHaveBeenCalledWith(1);
    expect(store.size).toBe(0);
  });

  it("syncQueue() calls onSynced callback after successful submission", async () => {
    mockedSubmitVote.mockResolvedValue({ data: {} });

    const onSynced = vi.fn();
    store.set(
      1,
      makeStoredEntry(1, {
        ballotId: "b3",
        voterToken: "c".repeat(64),
        optionId: "opt-3",
        weight: 1,
      }),
    );

    const { result } = renderHook(() => useOfflineQueue({ onSynced }));
    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(onSynced).toHaveBeenCalledWith(
      expect.objectContaining({ ballotId: "b3" }),
    );
  });

  it("syncQueue() calls onSyncFailed and keeps entry when submitVote throws", async () => {
    mockedSubmitVote.mockRejectedValue(new Error("Server error"));

    const onSyncFailed = vi.fn();
    store.set(
      1,
      makeStoredEntry(1, {
        ballotId: "b4",
        voterToken: "d".repeat(64),
        optionId: "opt-4",
        weight: 1,
      }),
    );

    const { result } = renderHook(() => useOfflineQueue({ onSyncFailed }));
    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(onSyncFailed).toHaveBeenCalledTimes(1);
    expect(fakeObjectStore.delete).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });

  it("syncQueue() is called automatically when the browser comes back online", async () => {
    mockedSubmitVote.mockResolvedValue({ data: {} });

    store.set(
      1,
      makeStoredEntry(1, {
        ballotId: "b5",
        voterToken: "e".repeat(64),
        optionId: "opt-5",
        weight: 1,
      }),
    );

    renderHook(() => useOfflineQueue());
    await waitFor(() => expect(indexedDB.open).toHaveBeenCalled());

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(mockedSubmitVote).toHaveBeenCalledTimes(1);
    });
  });
});
