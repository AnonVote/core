import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Toast from "./Toast";

interface Props {
  token: string;
  ballotId: string;
}

export default function TokenDisplay({ token, ballotId }: Props) {
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const navigate = useNavigate();

  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setShowToast(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const proceedToVote = async () => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {}
    navigate(`/vote/${ballotId}`, { state: { token } });
  };

  return (
    <div
      className="card p-6"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
      >
        <svg
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: "var(--brand-primary)", flexShrink: 0 }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-semibold)",
            fontSize: "var(--text-base)",
            color: "var(--ink-primary)",
          }}
        >
          Your Voting Token
        </span>
      </div>

      {/* Token box with inline copy icon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          background: "var(--surface-sunken)",
          border: "1px solid var(--border-medium)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3) var(--space-4)",
        }}
      >
        {/* Truncated token text */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            color: "var(--ink-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: "0.04em",
            minWidth: 0,
          }}
        >
          {token}
        </span>

        {/* Copy icon button */}
        <button
          onClick={copy}
          title={copied ? "Copied!" : "Copy token"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "var(--space-1)",
            borderRadius: "var(--radius-sm)",
            color: copied ? "var(--semantic-success)" : "var(--ink-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition:
              "color var(--transition-fast), background-color var(--transition-fast)",
          }}
          onMouseEnter={(e) => {
            if (!copied) e.currentTarget.style.color = "var(--brand-primary)";
            e.currentTarget.style.backgroundColor = "var(--brand-primary-pale)";
          }}
          onMouseLeave={(e) => {
            if (!copied) e.currentTarget.style.color = "var(--ink-muted)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          {copied ? (
            /* Checkmark */
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            /* Copy icon */
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Warning */}
      <div className="message message-warning" style={{ marginBottom: 0 }}>
        <span className="message-icon">
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </span>
        <span style={{ fontSize: "var(--text-sm)" }}>
          Save this token — it cannot be recovered. You'll need it to cast your
          vote.
        </span>
      </div>

      {/* Actions */}
      <button
        onClick={proceedToVote}
        className="btn-primary"
        style={{ width: "100%", minHeight: "48px" }}
      >
        Proceed to Vote →
      </button>

      {showToast && (
        <Toast
          message="Token copied to clipboard"
          type="success"
          onClose={() => setShowToast(false)}
        />
      )}
    </div>
  );
}
