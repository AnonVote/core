import { Link, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import type { Ballot } from "../types";
import Toast from "./Toast";
import { deleteBallot, tallyBallot } from "../api/client";
import { useNotifications } from "../context/NotificationContext";
import {
  DotsHorizontalIcon,
  ClipboardIcon,
  TrashIcon,
  CopyIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";
import BallotDescription from "./BallotDescription";

interface Props {
  ballot: Ballot;
  onBallotDeleted: () => void;
}

export default function BallotCard({ ballot, onBallotDeleted }: Props) {
  const navigate = useNavigate();
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTallying, setIsTallying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { addNotification } = useNotifications();
  const isOpen = ballot.status === "ACTIVE";
  const deadline = new Date(ballot.deadline);
  const tokenLink = `${window.location.origin}/vote/${ballot.id}/token`;

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(tokenLink);
      setToast({ message: "Voter link copied to clipboard!", type: "success" });
    } catch {
      setToast({
        message: "Failed to copy link. Please try again.",
        type: "error",
      });
    }
  };

  const handleTally = async () => {
    if (
      !confirm(
        "This will close the ballot and publish results. Voting will end immediately. Continue?",
      )
    )
      return;
    setIsTallying(true);
    try {
      await tallyBallot(ballot.id);
      addNotification({
        type: "results_published",
        title: "Results published",
        message: `"${ballot.topic}" has been closed and results are ready`,
      });
      setToast({
        message: "Ballot closed and results published.",
        type: "success",
      });
      onBallotDeleted();
    } catch (err: any) {
      setToast({
        message: err?.response?.data?.message || "Failed to tally ballot.",
        type: "error",
      });
    } finally {
      setIsTallying(false);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm("Are you sure you want to delete this ballot?")) return;
    setIsDeleting(true);
    try {
      await deleteBallot(ballot.id);
      setToast({ message: "Ballot deleted successfully", type: "success" });
      onBallotDeleted();
    } catch (err: any) {
      setToast({
        message:
          err?.response?.data?.message ||
          "Failed to delete ballot. Please try again.",
        type: "error",
      });
    } finally {
      setIsDeleting(false);
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
      {/* Header — topic + status badge + overflow menu */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3
          className="font-space-grotesk font-semibold text-lg leading-snug"
          style={{
            color: "var(--ink-primary)",
            flex: 1,
            /* Always reserve 2 lines — consistent card height */
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: "3em" /* 2 lines × 1.5 line-height */,
          }}
        >
          {ballot.topic}
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            flexShrink: 0,
          }}
        >
          <span
            className={
              ballot.status === "ACTIVE"
                ? "badge badge-open"
                : ballot.status === "DRAFT"
                  ? "badge badge-draft"
                  : "badge badge-closed"
            }
          >
            {ballot.status}
          </span>

          {/* Three-dot overflow menu */}
          <div style={{ position: "relative" }} ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              style={{
                background: "none",
                border: "1px solid var(--border-medium)",
                borderRadius: "var(--radius-sm)",
                width: "30px",
                height: "30px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--ink-muted)",
                transition:
                  "border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--brand-primary)";
                e.currentTarget.style.color = "var(--brand-primary)";
                e.currentTarget.style.background = "var(--brand-primary-pale)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-medium)";
                e.currentTarget.style.color = "var(--ink-muted)";
                e.currentTarget.style.background = "none";
              }}
            >
              <DotsHorizontalIcon width="14" height="14" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="More actions"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  minWidth: "160px",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-lg)",
                  zIndex: 50,
                  overflow: "hidden",
                  animation: "dropdown-in 150ms ease forwards",
                }}
              >
                {/* Audit */}
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(`/audit/${ballot.id}`);
                  }}
                  aria-label={`View audit log for ${ballot.topic}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    width: "100%",
                    padding: "var(--space-3) var(--space-4)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-primary)",
                    fontFamily: "var(--font-body)",
                    textAlign: "left",
                    transition: "background var(--transition-fast)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "var(--brand-primary-pale)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <ClipboardIcon width="14" height="14" />
                  Audit Log
                </button>

                {/* Divider */}
                <div
                  style={{
                    height: "1px",
                    background: "var(--border-soft)",
                    margin: "2px 0",
                  }}
                />

                {/* Delete */}
                <button
                  role="menuitem"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  aria-label={`Delete ${ballot.topic}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    width: "100%",
                    padding: "var(--space-3) var(--space-4)",
                    background: "none",
                    border: "none",
                    cursor: isDeleting ? "not-allowed" : "pointer",
                    fontSize: "var(--text-sm)",
                    color: "var(--semantic-error)",
                    fontFamily: "var(--font-body)",
                    textAlign: "left",
                    transition: "background var(--transition-fast)",
                    opacity: isDeleting ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "var(--semantic-error-light)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <TrashIcon width="14" height="14" />
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Encrypted description — decrypts in place, or shows a placeholder */}
      <BallotDescription
        descriptionCiphertext={ballot.descriptionCiphertext}
        clamp
      />

      {/* Stellar Anchor Status */}
      <div className="mb-4">
        {ballot.anchorStatus === "ANCHORED" && ballot.stellarTxId ? (
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--semantic-success)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${ballot.stellarTxId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "inherit" }}
            >
              Anchored to Stellar
            </a>
          </div>
        ) : ballot.anchorStatus === "PENDING" ? (
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            <div className="loading-dots-mini">
              <span></span><span></span><span></span>
            </div>
            <span>Stellar anchor pending...</span>
          </div>
        ) : ballot.anchorStatus === "FAILED" ? (
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--semantic-error)" }}
          >
            <ExclamationTriangleIcon width="12" height="12" />
            <span>Stellar anchor failed</span>
          </div>
        ) : null}
      </div>

      {/* Inconsistency Warning */}
      {ballot.result && !ballot.result.isConsistent && (
        <div className="message message-warning mb-4">
          <span className="message-icon" aria-hidden="true">
            <ExclamationTriangleIcon width="16" height="16" />
          </span>
          <span style={{ fontSize: "var(--text-sm)" }}>
            Inconsistency detected: vote count does not match issued tokens.
          </span>
        </div>
      )}

      {/* Stats Grid — 3 cols desktop, 2 cols mobile (Tokens moved to progress bar below) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {[
          {
            label: "Eligible",
            value: ballot.eligibleVoters ?? "—",
            mono: false,
            accent: false,
          },
          {
            label: "Votes",
            value: ballot.votesCast ?? "—",
            mono: false,
            accent: false,
          },
          {
            label: "Deadline",
            value: deadline.toLocaleDateString(),
            mono: false,
            accent: false,
            small: true,
          },
        ].map((stat) => (
          <div
            key={stat.label}
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
              {stat.label}
            </p>
            <p
              style={{
                color: stat.accent
                  ? "var(--brand-primary)"
                  : "var(--ink-primary)",
                fontWeight: "var(--weight-semibold)",
                fontSize: stat.small ? "var(--text-xs)" : "var(--text-base)",
                fontFamily: stat.mono ? "var(--font-mono)" : "inherit",
              }}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Token Issuance Progress — read-only; tokens are voter-initiated (self-service),
          so this only visualizes issuance so far, it does not trigger issuance. */}
      <div className="mb-5">
        {(() => {
          const issued = ballot.tokensIssued ?? 0;
          const eligible = ballot.eligibleVoters ?? 0;
          const pct = eligible > 0 ? Math.min(100, Math.round((issued / eligible) * 100)) : 0;
          return (
            <div
              style={{
                background: "var(--surface-base)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3)",
              }}
            >
              <div
                className="flex items-center justify-between mb-2"
                style={{ fontSize: "var(--text-xs)" }}
              >
                <span style={{ color: "var(--ink-muted)" }}>
                  Tokens Issued
                </span>
                <span
                  style={{
                    color: "var(--brand-primary)",
                    fontWeight: "var(--weight-semibold)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {issued}
                  {eligible > 0 ? ` / ${eligible}` : ""}
                  {eligible > 0 ? ` (${pct}%)` : ""}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Token issuance progress for ${ballot.topic}`}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  width: "100%",
                  height: "6px",
                  borderRadius: "var(--radius-full, 9999px)",
                  background: "var(--surface-sunken)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: "var(--brand-primary)",
                    borderRadius: "var(--radius-full, 9999px)",
                    transition: "width var(--transition-base, 300ms ease)",
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  marginTop: "var(--space-1)",
                }}
              >
                Voters request their own token — this can't be triggered from
                here by design (keeps voter identity separate from the admin).
              </p>
            </div>
          );
        })()}
      </div>

      {/* Action Buttons — clear hierarchy */}
      <div
        role="group"
        aria-label={`Actions for ${ballot.topic}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {/* Primary action — full width */}
        {isOpen ? (
          <button
            onClick={copyLink}
            className="btn-primary"
            aria-label={`Copy voter link for ${ballot.topic}`}
            style={{
              width: "100%",
              fontSize: "var(--text-sm)",
              padding: "10px 16px",
            }}
          >
            <CopyIcon width="14" height="14" style={{ marginRight: "6px" }} />
            Copy Voter Link
          </button>
        ) : ballot.result ? (
          <Link
            to={`/results/${ballot.id}`}
            className="btn-primary"
            aria-label={`View results for ${ballot.topic}`}
            style={{
              width: "100%",
              fontSize: "var(--text-sm)",
              padding: "10px 16px",
              textAlign: "center",
              display: "block",
            }}
          >
            View Results
          </Link>
        ) : null}

        {/* Secondary actions — side by side */}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Link
            to={`/ballots/${ballot.id}/edit`}
            className="btn-ghost"
            aria-label={`Edit ${ballot.topic}`}
            style={{
              flex: 1,
              fontSize: "var(--text-sm)",
              padding: "8px 12px",
              textAlign: "center",
            }}
          >
            Edit
          </Link>
          {isOpen && (
            <button
              onClick={handleTally}
              disabled={isTallying}
              className="btn-ghost"
              aria-label={`Close and tally ${ballot.topic}`}
              style={{
                flex: 1,
                fontSize: "var(--text-sm)",
                padding: "8px 12px",
              }}
            >
              {isTallying ? "Tallying…" : "Close Voting"}
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
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
