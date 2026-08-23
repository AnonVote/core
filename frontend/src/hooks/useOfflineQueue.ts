import { useCallback, useEffect, useRef } from "react";
import { submitVote } from "../api/client";

export interface QueuedVote {
  id?: number;
  ballotId: string;
  voterToken: string;
  optionId: string;
  weight?: number;
  rank?: number;
  queuedAt: number;
}

const DB_NAME = "anonvote-offline-queue";
const STORE_NAME = "votes";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(db: IDBDatabase, vote: QueuedVote): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(vote);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(db: IDBDatabase): Promise<QueuedVote[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedVote[]);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

interface UseOfflineQueueOptions {
  onSynced?: (vote: QueuedVote) => void;
  onSyncFailed?: (vote: QueuedVote, err: unknown) => void;
}

export function useOfflineQueue(options: UseOfflineQueueOptions = {}) {
  const dbRef = useRef<IDBDatabase | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    openDB()
      .then((db) => {
        dbRef.current = db;
      })
      .catch(console.error);

    return () => {
      dbRef.current?.close();
      dbRef.current = null;
    };
  }, []);

  const enqueue = useCallback(
    async (vote: Omit<QueuedVote, "id" | "queuedAt">): Promise<void> => {
      const db = dbRef.current;
      if (!db) return;
      await dbAdd(db, { ...vote, queuedAt: Date.now() });
    },
    [],
  );

  const syncQueue = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;

    let queued: QueuedVote[];
    try {
      queued = await dbGetAll(db);
    } catch {
      return;
    }

    for (const vote of queued) {
      try {
        await submitVote({
          ballotId: vote.ballotId,
          voterToken: vote.voterToken,
          optionId: vote.optionId,
          weight: vote.weight ?? 1,
          rank: vote.rank,
        });
        await dbDelete(db, vote.id!);
        optionsRef.current.onSynced?.(vote);
      } catch (err) {
        optionsRef.current.onSyncFailed?.(vote, err);
      }
    }
  }, []);

  // Auto-sync when the browser reports coming back online
  useEffect(() => {
    const handle = () => {
      syncQueue();
    };
    window.addEventListener("online", handle);
    return () => window.removeEventListener("online", handle);
  }, [syncQueue]);

  return { enqueue, syncQueue };
}
