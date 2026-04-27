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
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Audit Log</h1>
          {ballotId && (
            <Link
              to={`/results/${ballotId}`}
              className="text-indigo-400 hover:text-indigo-300 text-sm"
            >
              ← Results
            </Link>
          )}
        </div>
        {ballot && <p className="text-gray-400 mb-8">{ballot.topic}</p>}

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="bg-gray-900 rounded-xl h-20 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <p className="text-gray-400">{error}</p>
          </div>
        ) : audit ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
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
