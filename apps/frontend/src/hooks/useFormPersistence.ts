import { useState, useEffect, useCallback } from "react";
import {
  getOrCreateSessionKey,
  encryptJSON,
  decryptJSON,
} from "../utils/storage-crypto";

export interface PersistedVoteForm {
  token: string;
  selectedOption: string;
}

const KEY_PREFIX = "anonvote-vote-form_";

export function useFormPersistence(ballotId: string | undefined) {
  const key = ballotId ? `${KEY_PREFIX}${ballotId}` : null;

  const [savedDraft, setSavedDraft] = useState<PersistedVoteForm | null>(null);

  // Decrypt and load any saved draft on mount
  useEffect(() => {
    if (!key) return;
    (async () => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const cryptoKey = await getOrCreateSessionKey();
        const parsed = await decryptJSON<PersistedVoteForm>(raw, cryptoKey);
        if (parsed.token || parsed.selectedOption) {
          setSavedDraft(parsed);
        }
      } catch {
        // Key mismatch (stale session data) or corrupt — discard silently
        localStorage.removeItem(key);
      }
    })();
  }, [key]);

  const persist = useCallback(
    async (form: PersistedVoteForm): Promise<void> => {
      if (!key) return;
      if (!form.token && !form.selectedOption) return;
      try {
        const cryptoKey = await getOrCreateSessionKey();
        const encrypted = await encryptJSON(form, cryptoKey);
        localStorage.setItem(key, encrypted);
      } catch {
        // crypto or quota failure — ignore
      }
    },
    [key],
  );

  const clearPersisted = useCallback(() => {
    if (!key) return;
    localStorage.removeItem(key);
    setSavedDraft(null);
  }, [key]);

  const restoreDraft = useCallback((): PersistedVoteForm | null => {
    const draft = savedDraft;
    setSavedDraft(null);
    return draft;
  }, [savedDraft]);

  const dismissDraft = useCallback(() => {
    setSavedDraft(null);
  }, []);

  return { savedDraft, persist, clearPersisted, restoreDraft, dismissDraft };
}
