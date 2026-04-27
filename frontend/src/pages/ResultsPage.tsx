import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getResult, getBallot, getAudit } from "../api/client";
import Navbar from "../components/Navbar";
import ResultChart from "../components/ResultChart";
import type { Ballot, Result, AuditCounts, TallyEntry } from "../types";

export default function ResultsPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [audit, setAudit] = useState<AuditCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
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

  const buildTallyEntries = (): TallyEntry[] => {
    if (!result || !ballot) return [];
    const tally: Record<string, number> = JSON.parse(result.tallyJson);
    return ballot.options.map((opt) => {
      const count = tally[opt.id] ?? 0;
      const pct = result.totalVotes > 0 ? (count / result.totalVotes) * 100 : 0;
      return { optionId: opt.id, optionText: opt.text, count, percentage: pct };
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Results</h1>
        {ballot && <p className="text-gray-400 mb-8">{ballot.topic}</p>}

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-900 rounded-xl h-16 animate-pulse"
              />
            ))}
          </div>
        ) : notFound ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <p className="text-gray-400">
              No published results found for this ballot yet.
            </p>
            {ballot?.status === "OPEN" && (
              <p className="text-gray-500 text-sm mt-2">
                Results will be published after the voting deadline.
              </p>
            )}
          </div>
        ) : result ? (
          <div className="space-y-6">
            {!result.isConsistent && (
              <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
                ⚠️ Inconsistency detected in this result. Vote count may not
                match issued tokens.
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4">Vote Breakdown</h2>
              <ResultChart entries={buildTallyEntries()} />
              <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between text-sm text-gray-400">
                <span>Total votes</span>
                <span className="text-white font-semibold">
                  {result.totalVotes}
                </span>
              </div>
            </div>

            {result.stellarTxId && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-2">
                  Blockchain Verification
                </h2>
                <p className="text-gray-400 text-sm mb-3">
                  This result is permanently recorded on the Stellar blockchain.
                </p>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${result.stellarTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-sm font-mono break-all"
                >
                  {result.stellarTxId}
                  <svg
                    className="w-4 h-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            )}

            {audit && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-2">Audit Summary</h2>
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-gray-400">Tokens issued: </span>
                    <span className="text-white font-semibold">
                      {audit.tokensIssued}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Votes cast: </span>
                    <span className="text-white font-semibold">
                      {audit.votesCast}
                    </span>
                  </div>
                </div>
                <Link
                  to={`/audit/${ballotId}`}
                  className="text-indigo-400 hover:text-indigo-300 text-sm mt-3 inline-block"
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
