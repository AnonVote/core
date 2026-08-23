import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormPersistence } from "../hooks/useFormPersistence";

const BALLOT_ID = "ballot-persist-test";
const KEY = `anonvote-vote-form_${BALLOT_ID}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("useFormPersistence", () => {
  it("returns null savedDraft when localStorage is empty", () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    expect(result.current.savedDraft).toBeNull();
  });

  it("persist() writes form state to localStorage", () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    act(() => {
      result.current.persist({ token: "abc123", selectedOption: "opt-1" });
    });

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.token).toBe("abc123");
    expect(stored.selectedOption).toBe("opt-1");
  });

  it("loads a saved draft from localStorage on mount", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "saved-token", selectedOption: "opt-2" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    expect(result.current.savedDraft).not.toBeNull();
    expect(result.current.savedDraft?.token).toBe("saved-token");
    expect(result.current.savedDraft?.selectedOption).toBe("opt-2");
  });

  it("does not load a draft if both fields are empty strings", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "", selectedOption: "" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    expect(result.current.savedDraft).toBeNull();
  });

  it("does not load corrupt JSON from localStorage", () => {
    localStorage.setItem(KEY, "NOT_JSON{{{");

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    expect(result.current.savedDraft).toBeNull();
  });

  it("restoreDraft() returns the draft and clears savedDraft", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "restore-me", selectedOption: "opt-3" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    let draft: ReturnType<typeof result.current.restoreDraft>;
    act(() => {
      draft = result.current.restoreDraft();
    });

    expect(draft?.token).toBe("restore-me");
    expect(result.current.savedDraft).toBeNull();
  });

  it("dismissDraft() clears savedDraft without returning the data", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "dismiss-me", selectedOption: "" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));
    expect(result.current.savedDraft).not.toBeNull();

    act(() => {
      result.current.dismissDraft();
    });

    expect(result.current.savedDraft).toBeNull();
  });

  it("clearPersisted() removes the key from localStorage", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ token: "clear-me", selectedOption: "opt-1" }),
    );

    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    act(() => {
      result.current.clearPersisted();
    });

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.savedDraft).toBeNull();
  });

  it("persist() does not write to localStorage when both fields are empty", () => {
    const { result } = renderHook(() => useFormPersistence(BALLOT_ID));

    act(() => {
      result.current.persist({ token: "", selectedOption: "" });
    });

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("works correctly when ballotId is undefined", () => {
    const { result } = renderHook(() => useFormPersistence(undefined));
    // Should not throw and should not load any draft
    expect(result.current.savedDraft).toBeNull();

    act(() => {
      result.current.persist({ token: "x", selectedOption: "y" });
    });
    // No key should be written without a ballotId
    expect(localStorage.length).toBe(0);
  });
});
