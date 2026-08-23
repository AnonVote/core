import { useState, useEffect, useCallback } from "react";

export interface PersistedVoteForm {
  token: string;
  selectedOption: string;
}

const KEY_PREFIX = "anonvote-vote-form_";

export function useFormPersistence(ballotId: string | undefined) {
  const key = ballotId ? `${KEY_PREFIX}${ballotId}` : null;

  // Non-null means a saved draft exists and should prompt the user
  const [savedDraft, setSavedDraft] = useState<PersistedVoteForm | null>(null);

  // Load any saved draft on mount
  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedVoteForm;
      if (parsed.token || parsed.selectedOption) {
        setSavedDraft(parsed);
      }
    } catch {
      // corrupted — silently discard
    }
  }, [key]);

  const persist = useCallback(
    (form: PersistedVoteForm) => {
      if (!key) return;
      // Only persist if there is something worth saving
      if (!form.token && !form.selectedOption) return;
      try {
        localStorage.setItem(key, JSON.stringify(form));
      } catch {
        // quota exceeded — ignore
      }
    },
    [key],
  );

  const clearPersisted = useCallback(() => {
    if (!key) return;
    localStorage.removeItem(key);
    setSavedDraft(null);
  }, [key]);

  // Accept the saved draft and return its values
  const restoreDraft = useCallback((): PersistedVoteForm | null => {
    const draft = savedDraft;
    setSavedDraft(null); // dismiss the restore banner
    return draft;
  }, [savedDraft]);

  // Dismiss without restoring
  const dismissDraft = useCallback(() => {
    setSavedDraft(null);
  }, []);

  return { savedDraft, persist, clearPersisted, restoreDraft, dismissDraft };
}
