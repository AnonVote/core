import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getBallotSummary, tallyBallot } from "../../api/client";
import Navbar from "../../components/Navbar";
import type { BallotSummary } from "../../types";

export default function BallotDetailPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const navigate = useNavigate();
  const [ballot, setBallot] = useState<BallotSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState("");
  const [error, setError] = useState("");

  const fetchBallot = async () => {
    if (!ballotId) return;
    try {
      const res = await getBallotSummary(ballotId);
      setBallot(res.data.data);
    } catch {
      setError("Ballot not found");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBallot();
  }, [ballotId]);

  // Live countdown
  useEffect(() => {
    if (!ballot) return;
    const deadline = new Date(ballot.deadline).getTime();
    const updateCountdown = () => {
      const now = Date.now();
      const diff = deadline - now;
      if (diff <= 0) {
        setCountdown("Deadline passed");
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdown(`${hours}h ${minutes}m ${seconds}s`);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [ballot]);

  const handleTally = async () => {
    if (!ballotId || !ballot) return;
    if (!confirm("Close this ballot and tally results? Voting will end.")) return;
    try {
      await tallyBallot(ballotId);
      await fetchBallot();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to tally");
    }
  };

  if (loading) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div className="p-8 max-w-4xl mx-auto">
          <div className="skeleton h-8 w-64 mb-4" />
          <div className="skeleton h-4 w-48 mb-8" />
          <div className="skeleton h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !ballot) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div className="p-8 max-w-4xl mx-auto">
          <div className="card p-8 text-center">
            <p style={{ color: "var(--ink-muted)" }}>{error || "Ballot not found"}</p>
            <button onClick={() => navigate("/dashboard")} className="btn-ghost mt-4">
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    DRAFT: "var(--ink-muted)",
    ACTIVE: "var(--semantic-success)",
    CLOSED: "var(--semantic-warning)",
    FINALISED: "var(--brand-primary)",
  };

  const anchorColors: Record<string, string> = {
    ANCHORED: "var(--semantic-success)",
    PENDING: "var(--semantic-warning)",
    FAILED: "var(--semantic-error)",
  };

  return (
    <div className="page-wrapper">
      <Navbar />
      <div className="p-8 max-w-4xl mx-auto" style={{ width: "100%" }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink-muted)",
            cursor: "pointer",
            fontSize: "var(--text-sm)",
            padding: 0,
            marginBottom: "var(--space-4)",
            fontFamily: "var(--font-body)",
          }}
        >
          ← Back to Dashboard
        </button>

        {/* Ballot Metadata */}
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-space-grotesk font-bold" style={{ color: "var(--ink-primary)" }}>
              {ballot.topic}
            </h1>
            <span
              className="px-3 py-1 rounded-full text-sm font-medium"
              style={{
                background: `${statusColors[ballot.status] || "var(--ink-muted)"}20`,
                color: statusColors[ballot.status] || "var(--ink-muted)",
                border: `1px solid ${statusColors[ballot.status] || "var(--ink-muted)"}`,
              }}
            >
              {ballot.status}
            </span>
          </div>

          {/* Deadline Countdown */}
          <div className="mb-4">
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Deadline</p>
            <p className="text-lg font-mono font-semibold" style={{ color: "var(--ink-primary)" }}>
              {countdown || "N/A"}
            </p>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {new Date(ballot.deadline).toLocaleString()}
            </p>
          </div>

          {/* Options List */}
          <div className="mb-4">
            <p className="text-sm font-semibold mb-2" style={{ color: "var(--ink-primary)" }}>
              Options ({ballot.options?.length || 0})
            </p>
            <ul className="space-y-1">
              {ballot.options?.map((opt, i) => (
                <li key={opt.id} className="text-sm" style={{ color: "var(--ink-secondary)" }}>
                  {i + 1}. {opt.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Stellar Anchor Section */}
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--ink-primary)" }}>
            Stellar Anchor
          </h2>
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{
                background: anchorColors[ballot.anchorStatus || "PENDING"] || "var(--ink-muted)",
              }}
            />
            <span className="text-sm" style={{ color: "var(--ink-primary)" }}>
              Status: {ballot.anchorStatus || "PENDING"}
            </span>
          </div>
          {ballot.stellarTxId && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${ballot.stellarTxId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:underline"
              style={{ color: "var(--brand-primary)" }}
            >
              View on Stellar Explorer →
            </a>
          )}
          {ballot.anchorStatus === "FAILED" && (
            <button
              onClick={async () => {
                try {
                  await fetch(`/api/ballots/${ballot.id}/retry-anchor`, { method: "POST", credentials: "include" });
                  await fetchBallot();
                } catch {
                  setError("Retry failed");
                }
              }}
              className="btn-secondary mt-2"
              style={{ fontSize: "var(--text-sm)" }}
            >
              Retry Anchor
            </button>
          )}
        </div>

        {/* Voter Activity Section */}
        <div className="card p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--ink-primary)" }}>
            Voter Activity
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Tokens Issued</p>
              <p className="text-xl font-semibold" style={{ color: "var(--ink-primary)" }}>
                {ballot.tokensIssued ?? 0}
              </p>
            </div>
            <div>
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Votes Cast</p>
              <p className="text-xl font-semibold" style={{ color: "var(--ink-primary)" }}>
                {ballot.votesCast ?? 0}
              </p>
            </div>
            <div>
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Participation</p>
              <p className="text-xl font-semibold" style={{ color: "var(--ink-primary)" }}>
                {ballot.eligibleVoters && ballot.eligibleVoters > 0
                  ? `${Math.round(((ballot.votesCast ?? 0) / ballot.eligibleVoters) * 100)}%`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {ballot.status === "DRAFT" && (
            <button
              onClick={() => navigate(`/ballots/${ballot.id}/edit`)}
              className="btn-primary"
            >
              Edit Ballot
            </button>
          )}
          {ballot.status === "ACTIVE" && (
            <button onClick={handleTally} className="btn-primary">
              Close Ballot & Tally
            </button>
          )}
          {(ballot.status === "CLOSED" || ballot.status === "FINALISED") && (
            <button
              onClick={() => navigate(`/results/${ballot.id}`)}
              className="btn-primary"
            >
              View Results
            </button>
          )}
        </div>
      </div>
    </div>
  );
}