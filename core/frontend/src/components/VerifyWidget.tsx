import { useState, FormEvent } from "react";
import { verifyToken } from "../api/client";

interface Props {
  ballotId: string;
}

type VerifyState = "idle" | "loading" | "confirmed" | "not_found" | "error";

/**
 * VerifyWidget — self-verification widget for voters.
 *
 * Privacy boundary: the API returns ONLY { confirmed: boolean }.
 * This component intentionally displays no vote option, no voter data,
 * and no aggregate information beyond the single boolean result.
 */
export default function VerifyWidget({ ballotId }: Props) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<VerifyState>("idle");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setState("loading");
    try {
      const res = await verifyToken(ballotId, trimmed);
      setState(res.data.confirmed ? "confirmed" : "not_found");
    } catch {
      setState("error");
    }
  };

  const reset = () => {
    setToken("");
    setState("idle");
  };

  return (
    <div className="card p-6">
      <h2
        className="font-space-grotesk font-semibold mb-2"
        style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
      >
        Verify Your Vote
      </h2>
      <p
        style={{
          color: "var(--ink-muted)",
          fontSize: "var(--text-sm)",
          marginBottom: "var(--space-4)",
        }}
      >
        Enter your voter token to confirm your vote was recorded. No other
        information will be revealed.
      </p>

      {state === "idle" || state === "loading" ? (
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "var(--space-3)" }}>
          <input
            id="verify-token-input"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your voter token…"
            disabled={state === "loading"}
            style={{
              flex: 1,
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-raised)",
              color: "var(--ink-primary)",
              fontSize: "var(--text-sm)",
              fontFamily: "monospace",
            }}
          />
          <button
            id="verify-submit-btn"
            type="submit"
            className="btn-primary"
            disabled={state === "loading" || !token.trim()}
            style={{ whiteSpace: "nowrap" }}
          >
            {state === "loading" ? "Checking…" : "Verify"}
          </button>
        </form>
      ) : state === "confirmed" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            background: "color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-success, #22c55e) 30%, transparent)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>✓</span>
          <span style={{ color: "var(--ink-primary)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>
            Your vote was recorded for this ballot.
          </span>
          <button
            onClick={reset}
            className="link-dark"
            style={{ marginLeft: "auto", fontSize: "var(--text-sm)", background: "none", border: "none", cursor: "pointer" }}
          >
            Check another
          </button>
        </div>
      ) : state === "not_found" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            background: "color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-danger, #ef4444) 25%, transparent)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>✗</span>
          <span style={{ color: "var(--ink-primary)", fontSize: "var(--text-sm)" }}>
            No vote found for this token on this ballot.
          </span>
          <button
            onClick={reset}
            className="link-dark"
            style={{ marginLeft: "auto", fontSize: "var(--text-sm)", background: "none", border: "none", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            background: "color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 25%, transparent)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>⚠</span>
          <span style={{ color: "var(--ink-primary)", fontSize: "var(--text-sm)" }}>
            Unable to verify — please try again.
          </span>
          <button
            onClick={reset}
            className="link-dark"
            style={{ marginLeft: "auto", fontSize: "var(--text-sm)", background: "none", border: "none", cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
