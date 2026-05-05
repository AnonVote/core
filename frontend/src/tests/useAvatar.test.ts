import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAvatar } from "../hooks/useAvatar";

// jsdom doesn't support dispatchEvent on window by default — patch it
const listeners: Record<string, EventListener[]> = {};
window.addEventListener = (type: string, handler: EventListener) => {
  if (!listeners[type]) listeners[type] = [];
  listeners[type].push(handler);
};
window.dispatchEvent = (event: Event) => {
  (listeners[event.type] || []).forEach((h) => h(event));
  return true;
};

describe("useAvatar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null avatarUrl when nothing is stored", () => {
    const { result } = renderHook(() => useAvatar());
    expect(result.current.avatarUrl).toBeNull();
  });

  it("returns stored avatar from localStorage on mount", () => {
    localStorage.setItem("anonvote-avatar", "data:image/png;base64,abc");
    const { result } = renderHook(() => useAvatar());
    expect(result.current.avatarUrl).toBe("data:image/png;base64,abc");
  });

  it("removeAvatar clears avatarUrl and localStorage", () => {
    localStorage.setItem("anonvote-avatar", "data:image/png;base64,abc");
    const { result } = renderHook(() => useAvatar());
    act(() => {
      result.current.removeAvatar();
    });
    expect(result.current.avatarUrl).toBeNull();
    expect(localStorage.getItem("anonvote-avatar")).toBeNull();
  });

  it("uploadAvatar rejects files over 2MB", async () => {
    const { result } = renderHook(() => useAvatar());
    const bigFile = new File(["x".repeat(3 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    await expect(result.current.uploadAvatar(bigFile)).rejects.toThrow(/2MB/i);
  });

  it("uploadAvatar rejects non-image files", async () => {
    const { result } = renderHook(() => useAvatar());
    const textFile = new File(["hello"], "doc.txt", { type: "text/plain" });
    await expect(result.current.uploadAvatar(textFile)).rejects.toThrow(
      /image/i,
    );
  });
});
