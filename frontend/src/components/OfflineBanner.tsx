import { useOnlineStatus } from "../hooks/useOnlineStatus";

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="offline-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#f59e0b",
        color: "#78350f",
        padding: "0.5rem 1rem",
        textAlign: "center",
        fontSize: "0.875rem",
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
      }}
    >
      <span aria-hidden="true">⚡</span>
      You are offline — vote submission is unavailable until your connection is restored.
    </div>
  );
}
