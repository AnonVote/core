import { Link } from "react-router-dom";
import { useState } from "react";
import type { Ballot } from "../types";
import Toast from "./Toast";

interface Props {
  ballot: Ballot;
}

export default function BallotCard({ ballot }: Props) {
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const isOpen = ballot.status === "OPEN";
  const deadline = new Date(ballot.deadline);
  const tokenLink = `${window.location.origin}/vote/${ballot.id}/token`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(tokenLink);
      setToast({ message: "Voter link copied to clipboard!", type: "success" });
    } catch (err) {
      console.error("Failed to copy:", err);
      setToast({
        message: "Failed to copy link. Please try again.",
        type: "error",
      });
    }
  };

  return (
    <div
      className="card p-6"
      style={{
        transition:
          "border-color var(--transition-base), box-shadow var(--transition-base)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <h3
          className="font-space-grotesk font-semibold text-lg leading-snug"
          style={{ color: "var(--ink-primary)" }}
        >
          {ballot.topic}
        </h3>
        <span className={isOpen ? "badge badge-open" : "badge badge-closed"}>
          {isOpen ? "OPEN" : "CLOSED"}
        </span>
      </div>

      {/* Inconsistency Warning */}
      {ballot.result && !ballot.result.isConsistent && (
        <div className="message message-warning mb-4">
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
            Inconsistency detected: vote count does not match issued tokens.
          </span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div
          style={{
            background: "var(--surface-base)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              color: "var(--ink-muted)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-1)",
            }}
          >
            Eligible
          </p>
          <p
            style={{
              color: "var(--ink-primary)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-base)",
            }}
          >
            {ballot.eligibleVoters ?? "—"}
          </p>
        </div>
        <div
          style={{
            background: "var(--surface-base)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              color: "var(--ink-muted)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-1)",
            }}
          >
            Votes Cast
          </p>
          <p
            style={{
              color: "var(--ink-primary)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-base)",
            }}
          >
            {ballot.votesCast ?? "—"}
          </p>
        </div>
        <div
          style={{
            background: "var(--surface-base)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              color: "var(--ink-muted)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-1)",
            }}
          >
            Deadline
          </p>
          <p
            style={{
              color: "var(--ink-primary)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-xs)",
            }}
          >
            {deadline.toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <button
            onClick={copyLink}
            className="btn-primary"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "var(--text-sm)",
              padding: "8px 12px",
            }}
          >
            Copy Voter Link
          </button>
        )}
        {!isOpen && ballot.result && (
          <Link
            to={`/results/${ballot.id}`}
            className="btn-ghost"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "var(--text-sm)",
              padding: "8px 12px",
              textAlign: "center",
            }}
          >
            View Results
          </Link>
        )}
        <Link
          to={`/audit/${ballot.id}`}
          className="btn-ghost"
          style={{ fontSize: "var(--text-sm)", padding: "8px 12px" }}
        >
          Audit
        </Link>
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
