import { useCallback, useEffect, useRef } from "react";
import { submitVote } from "../api/client";
import {
  getOrCreateSessionKey,
  encryptJSON,
  decryptJSON,
} from "../utils/storage-crypto";

export interface QueuedVote {
  id?: number;
  ballotId: string;
  voterToken: string;
  optionId: string;
  weight?: number;
  rank?: number;
  queuedAt: number;
}

interface StoredEntry {
  id?: number;
  encryptedPayload: string;
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(db: IDBDatabase, entry: StoredEntry): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(entry);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(db: IDBDatabase): Promise<StoredEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as StoredEntry[]);
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
      const queuedAt = Date.now();
      const cryptoKey = await getOrCreateSessionKey();
      const encryptedPayload = await encryptJSON(
        { ...vote, queuedAt },
        cryptoKey,
      );
      await dbAdd(db, { encryptedPayload, queuedAt });
    },
    [],
  );

  const syncQueue = useCallback(async (): Promise<void> => {
    const db = dbRef.current;
    if (!db) return;

    let entries: StoredEntry[];
    try {
      entries = await dbGetAll(db);
    } catch {
      return;
    }

    const cryptoKey = await getOrCreateSessionKey();

    for (const entry of entries) {
      let vote: QueuedVote;
      try {
        vote = await decryptJSON<QueuedVote>(entry.encryptedPayload, cryptoKey);
        vote.id = entry.id;
      } catch {
        // Stale entry encrypted with a different session key — remove it
        await dbDelete(db, entry.id!);
        continue;
      }

      try {
        await submitVote({
          ballotId: vote.ballotId,
          voterToken: vote.voterToken,
          optionId: vote.optionId,
          weight: vote.weight ?? 1,
          rank: vote.rank,
        });
        await dbDelete(db, entry.id!);
        optionsRef.current.onSynced?.(vote);
      } catch (err) {
        optionsRef.current.onSyncFailed?.(vote, err);
      }
    }
  }, []);

  useEffect(() => {
    const handle = () => {
      syncQueue();
    };
    window.addEventListener("online", handle);
    return () => window.removeEventListener("online", handle);
  }, [syncQueue]);

  return { enqueue, syncQueue };
}
