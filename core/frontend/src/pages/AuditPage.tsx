import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getAudit, getBallot } from "../api/client";
import Navbar from "../components/Navbar";
import AuditTable from "../components/AuditTable";
import type { AuditCounts, Ballot } from "../types";

export default function AuditPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [audit, setAudit] = useState<AuditCounts | null>(null);
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ballotId) return;
    Promise.all([
      getAudit(ballotId).catch(() => null),
      getBallot(ballotId).catch(() => null),
    ]).then(([a, b]) => {
      if (a) setAudit(a.data.data);
      else setError("No audit data found for this ballot.");
      if (b) setBallot(b.data.data);
      setLoading(false);
    });
  }, [ballotId]);

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
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-eyebrow mb-2">Audit Log</div>
            <h1
              className="font-space-grotesk font-bold"
              style={{
                fontSize: "var(--text-2xl)",
                color: "var(--ink-primary)",
              }}
            >
              Audit Log
            </h1>
          </div>
          {ballotId && (
            <Link
              to={`/results/${ballotId}`}
              className="link-dark"
              style={{ fontSize: "var(--text-sm)" }}
            >
              ← Results
            </Link>
          )}
        </div>

        {ballot && (
          <p
            style={{
              color: "var(--ink-muted)",
              fontSize: "var(--text-base)",
              marginBottom: "var(--space-8)",
            }}
          >
            {ballot.topic}
          </p>
        )}

        {/* Content */}
        {loading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {[1, 2].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: "80px", borderRadius: "var(--radius-lg)" }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="card p-8" style={{ textAlign: "center" }}>
            <p style={{ color: "var(--ink-muted)" }}>{error}</p>
          </div>
        ) : audit ? (
          <div className="card p-6">
            <AuditTable
              events={audit.events}
              tokensIssued={audit.tokensIssued}
              votesCast={audit.votesCast}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
