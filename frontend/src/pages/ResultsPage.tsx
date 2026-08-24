import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getResult, getBallot, getAudit } from "../api/client";
import Navbar from "../components/Navbar";
import ResultChart from "../components/ResultChart";
import VerifyWidget from "../components/VerifyWidget";
import { useCountdown } from "../hooks/useCountdown";
import type { Ballot, Result, AuditCounts } from "../types";

// ── Countdown Banner ─────────────────────────────────────────────────────────
function CountdownBanner({ deadline }: { deadline: string }) {
  const { days, hours, minutes, seconds, expired } = useCountdown(deadline);

  if (expired) {
    return (
      <div className="card p-6" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--ink-muted)" }}>
          Voting has closed. Results are being tallied.
        </p>
      </div>
    );
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="card p-6">
      <h2
        className="font-space-grotesk font-semibold mb-4"
        style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
      >
        Voting in Progress
      </h2>
      <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
        Results will be published after the deadline.
      </p>
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          justifyContent: "center",
        }}
      >
        {[
          { label: "Days", value: days },
          { label: "Hours", value: hours },
          { label: "Minutes", value: minutes },
          { label: "Seconds", value: seconds },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: "56px",
              padding: "var(--space-3)",
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-2xl)",
                fontWeight: "var(--weight-bold)",
                color: "var(--ink-primary)",
                fontVariantNumeric: "tabular-nums",
                fontFamily: "monospace",
              }}
            >
              {pad(value)}
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-muted)", marginTop: "2px" }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Participation Bar ─────────────────────────────────────────────────────────
function ParticipationBar({
  participationRate,
  totalVotes,
  tokensIssued,
}: {
  participationRate: number;
  totalVotes: number;
  tokensIssued: number;
}) {
  return (
    <div className="card p-6">
      <h2
        className="font-space-grotesk font-semibold mb-3"
        style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
      >
        Participation
      </h2>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", marginBottom: "var(--space-2)" }}>
        <span style={{ color: "var(--ink-muted)" }}>
          {totalVotes} of {tokensIssued} eligible voters
        </span>
        <span style={{ color: "var(--ink-primary)", fontWeight: "var(--weight-semibold)" }}>
          {participationRate}%
        </span>
      </div>
      <div
        style={{
          height: "8px",
          background: "var(--border-soft)",
          borderRadius: "9999px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(participationRate, 100)}%`,
            background: "var(--color-accent, #6366f1)",
            borderRadius: "9999px",
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

// ── Copy Link Button ──────────────────────────────────────────────────────────
function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="btn-secondary"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}
      title="Copy shareable results link"
    >
      {copied ? (
        <>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Share Results
        </>
      )}
    </button>
  );
}

// ── Blockchain Anchor Card ────────────────────────────────────────────────────
function AnchorCard({ label, txId, explorerUrl }: { label: string; txId: string; explorerUrl: string }) {
  return (
    <div style={{ marginBottom: "var(--space-4)" }}>
      <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)", marginBottom: "var(--space-1)" }}>
        {label}
      </p>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="chip-mono"
        style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", wordBreak: "break-all" }}
      >
        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        {txId}
      </a>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [audit, setAudit] = useState<AuditCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(() => {
    if (!ballotId) return;
    Promise.all([
      getBallot(ballotId).catch(() => null),
      getResult(ballotId).catch(() => null),
      getAudit(ballotId).catch(() => null),
    ]).then(([b, r, a]) => {
      if (b) setBallot(b.data.data);
      if (r) setResult(r.data.data);
      else setNotFound(true);
      if (a) setAudit(a.data.data);
      setLoading(false);
    });
  }, [ballotId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch when countdown expires (ballot deadline passed)
  const handleExpired = useCallback(() => {
    if (!result) {
      setLoading(true);
      fetchData();
    }
  }, [result, fetchData]);

  const isActive = ballot?.status === "OPEN" && !result;

  return (
    <div className="page-wrapper">
      <Navbar />
      <div
        style={{
          maxWidth: "860px",
          margin: "0 auto",
          padding: "var(--space-10) 0",
          width: "100%",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "var(--space-3)",
            flexWrap: "wrap",
            gap: "var(--space-3)",
          }}
        >
          <div>
            <div className="text-eyebrow mb-2">Results</div>
            <h1
              className="font-space-grotesk font-bold"
              style={{ fontSize: "var(--text-2xl)", color: "var(--ink-primary)" }}
            >
              {ballot?.topic ?? "Election Results"}
            </h1>
          </div>
          <CopyLinkButton />
        </div>

        {ballot && (
          <p
            style={{
              color: "var(--ink-muted)",
              fontSize: "var(--text-base)",
              marginBottom: "var(--space-8)",
            }}
          >
            {new Date(ballot.deadline) > new Date()
              ? `Voting closes ${new Date(ballot.deadline).toLocaleString()}`
              : `Voting closed ${new Date(ballot.deadline).toLocaleString()}`}
          </p>
        )}

        {/* Loading */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: "64px", borderRadius: "var(--radius-lg)" }}
              />
            ))}
          </div>
        ) : isActive && ballot ? (
          // ── Pre-results: ballot still active ───────────────────────────────
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <CountdownBannerWithExpiry deadline={ballot.deadline} onExpired={handleExpired} />
          </div>
        ) : notFound && !isActive ? (
          <div className="card p-8" style={{ textAlign: "center" }}>
            <p style={{ color: "var(--ink-muted)" }}>
              No published results found for this ballot yet. Check back shortly.
            </p>
          </div>
        ) : result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>

            {/* Inconsistency Warning */}
            {!result.isConsistent && (
              <div className="message message-warning">
                <span className="message-icon">
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </span>
                <span>
                  Inconsistency detected — vote count may not match issued tokens.
                </span>
              </div>
            )}

            {/* Vote Breakdown */}
            <div className="card p-6">
              <h2
                className="font-space-grotesk font-semibold mb-4"
                style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
              >
                Vote Breakdown
              </h2>
              <ResultChart
                entries={
                  result.options ??
                  (() => {
                    const tally: Record<string, number> = JSON.parse(result.tallyJson);
                    return (ballot?.options ?? []).map((opt) => {
                      const count = tally[opt.id] ?? 0;
                      const pct = result.totalVotes > 0 ? (count / result.totalVotes) * 100 : 0;
                      return { optionId: opt.id, optionText: opt.text, count, percentage: pct };
                    });
                  })()
                }
              />
              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-soft)",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "var(--text-sm)",
                }}
              >
                <span style={{ color: "var(--ink-muted)" }}>Total votes cast</span>
                <span style={{ color: "var(--ink-primary)", fontWeight: "var(--weight-semibold)" }}>
                  {result.totalVotes}
                </span>
              </div>
            </div>

            {/* Participation */}
            {result.participationRate !== undefined && result.tokensIssued !== undefined && (
              <ParticipationBar
                participationRate={result.participationRate}
                totalVotes={result.totalVotes}
                tokensIssued={result.tokensIssued}
              />
            )}

            {/* Blockchain Verification */}
            {(result.stellarTxId || result.sorobanTxId) && (
              <div className="card p-6">
                <h2
                  className="font-space-grotesk font-semibold mb-2"
                  style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
                >
                  Blockchain Verification
                </h2>
                <p
                  style={{
                    color: "var(--ink-muted)",
                    fontSize: "var(--text-sm)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  This result is permanently anchored on the Stellar blockchain.
                </p>
                {result.stellarTxId && result.explorerUrl && (
                  <AnchorCard
                    label="Stellar (manageData)"
                    txId={result.stellarTxId}
                    explorerUrl={result.explorerUrl}
                  />
                )}
                {result.sorobanTxId && result.sorobanExplorerUrl && (
                  <AnchorCard
                    label="Soroban contract (record_result)"
                    txId={result.sorobanTxId}
                    explorerUrl={result.sorobanExplorerUrl}
                  />
                )}
              </div>
            )}

            {/* Self-verification widget */}
            {ballotId && <VerifyWidget ballotId={ballotId} />}

            {/* Audit Summary */}
            {audit && (
              <div className="card p-6">
                <h2
                  className="font-space-grotesk font-semibold mb-4"
                  style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
                >
                  Audit Summary
                </h2>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-6)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}>
                      Tokens issued{" "}
                    </span>
                    <span style={{ color: "var(--ink-primary)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)" }}>
                      {audit.tokensIssued}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}>
                      Votes cast{" "}
                    </span>
                    <span style={{ color: "var(--ink-primary)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)" }}>
                      {audit.votesCast}
                    </span>
                  </div>
                </div>
                <Link
                  to={`/audit/${ballotId}`}
                  className="link-dark"
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  View full audit log →
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Wrapper to pass onExpired callback into CountdownBanner
function CountdownBannerWithExpiry({
  deadline,
  onExpired,
}: {
  deadline: string;
  onExpired: () => void;
}) {
  const { days, hours, minutes, seconds, expired } = useCountdown(deadline);

  useEffect(() => {
    if (expired) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  if (expired) {
    return (
      <div className="card p-6" style={{ textAlign: "center" }}>
        <p style={{ color: "var(--ink-muted)" }}>
          Voting has closed. Results are being tallied — refresh shortly.
        </p>
      </div>
    );
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="card p-6">
      <h2
        className="font-space-grotesk font-semibold mb-4"
        style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
      >
        Voting in Progress
      </h2>
      <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
        Results will be published after the deadline.
      </p>
      <div style={{ display: "flex", gap: "var(--space-4)", justifyContent: "center" }}>
        {[
          { label: "Days", value: days },
          { label: "Hours", value: hours },
          { label: "Minutes", value: minutes },
          { label: "Seconds", value: seconds },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: "56px",
              padding: "var(--space-3)",
              background: "var(--surface-raised)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-soft)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-2xl)",
                fontWeight: "var(--weight-bold)",
                color: "var(--ink-primary)",
                fontVariantNumeric: "tabular-nums",
                fontFamily: "monospace",
              }}
            >
              {pad(value)}
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-muted)", marginTop: "2px" }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


