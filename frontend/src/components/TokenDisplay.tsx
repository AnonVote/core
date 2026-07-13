import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Toast from "./Toast";
import {
  KeyboardIcon,
  CheckIcon,
  CopyIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";

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
        <KeyboardIcon
          width="18"
          height="18"
          style={{ color: "var(--brand-primary)", flexShrink: 0 }}
        />
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
          aria-label={
            copied ? "Token copied to clipboard" : "Copy token to clipboard"
          }
          aria-pressed={copied}
          style={{
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
            <CheckIcon width="16" height="16" />
          ) : (
            <CopyIcon width="16" height="16" />
          )}
        </button>
      </div>

      {/* Warning */}
      <div className="message message-warning" style={{ marginBottom: 0 }}>
        <span className="message-icon">
          <ExclamationTriangleIcon width="16" height="16" />
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
