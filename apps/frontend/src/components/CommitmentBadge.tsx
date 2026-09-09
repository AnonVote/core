/**
 * Ballot commitment status badge (Issue #86).
 *
 * Renders what was actually verified, and says so honestly — `source` matters:
 * a match against the database copy is NOT the same assurance as a match
 * against the chain, and the badge must never imply otherwise.
 */
import { useEffect, useState } from "react";
import { getBallotCommitment } from "../api/client";
import type { BallotCommitment, CommitmentStatus } from "../types";

interface Props {
  ballotId: string;
  /** Skip the fetch and render a known result (used by the results page). */
  commitment?: BallotCommitment;
}

const PRESENTATION: Record<
  CommitmentStatus,
  { label: string; detail: string; fg: string; bg: string; border: string }
> = {
  verified: {
    label: "Content verified",
    detail:
      "This ballot's contents match the commitment recorded when voting opened.",
    fg: "var(--success-fg, #14532d)",
    bg: "var(--success-bg, #dcfce7)",
    border: "var(--success-border, #86efac)",
  },
  mismatch: {
    label: "Content altered",
    detail:
      "This ballot no longer matches the commitment recorded when voting opened. Do not trust its contents.",
    fg: "var(--danger-fg, #7f1d1d)",
    bg: "var(--danger-bg, #fee2e2)",
    border: "var(--danger-border, #fca5a5)",
  },
  unanchored: {
    label: "Not anchored",
    detail:
      "No commitment was recorded for this ballot, so its contents cannot be verified.",
    fg: "var(--warning-fg, #78350f)",
    bg: "var(--warning-bg, #fef3c7)",
    border: "var(--warning-border, #fcd34d)",
  },
};

const SOURCE_NOTE: Record<BallotCommitment["source"], string> = {
  chain: "Checked against the Stellar/Soroban ledger.",
  database: "Checked against this server's stored copy — not the ledger.",
  none: "",
};

export default function CommitmentBadge({ ballotId, commitment }: Props) {
  const [data, setData] = useState<BallotCommitment | null>(commitment ?? null);
  const [loading, setLoading] = useState(!commitment);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (commitment) {
      setData(commitment);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getBallotCommitment(ballotId)
      .then((res) => {
        if (!cancelled) setData(res.data.data);
      })
      .catch(() => {
        // A failed check is reported as such — never as a pass.
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ballotId, commitment]);

  if (loading) {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}
      >
        Checking ballot integrity…
      </span>
    );
  }

  if (failed || !data) {
    return (
      <span
        role="status"
        style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}
      >
        Ballot integrity could not be checked.
      </span>
    );
  }

  const style = PRESENTATION[data.status];
  const sourceNote = SOURCE_NOTE[data.source];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md, 8px)",
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.fg,
        fontSize: "var(--text-sm)",
      }}
    >
      <strong>{style.label}</strong>
      <span>{style.detail}</span>
      {sourceNote && (
        <span style={{ opacity: 0.8, fontSize: "var(--text-xs)" }}>
          {sourceNote}
        </span>
      )}
    </div>
  );
}
