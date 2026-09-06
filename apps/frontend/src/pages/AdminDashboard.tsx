import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getAdminBallotSummary, getAdminBallots } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { AdminBallotSummary, Ballot } from "../types";

const statusStyles: Record<string, string> = {
  DRAFT: "var(--ink-muted)",
  ACTIVE: "var(--semantic-success)",
  CLOSED: "var(--semantic-warning)",
  FINALISED: "var(--brand-primary)",
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, loading, orgName } = useAuth();
  const [summary, setSummary] = useState<AdminBallotSummary[]>([]);
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    try {
      setError(null);
      const [summaryRes, ballotRes] = await Promise.all([
        getAdminBallotSummary(),
        getAdminBallots(),
      ]);
      setSummary(summaryRes.data.data ?? []);
      setBallots(ballotRes.data.data ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Unable to load ballot dashboard");
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
      return;
    }

    if (!loading) {
      fetchDashboard();
    }
  }, [loading, isAuthenticated, navigate]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!loading && isAuthenticated) {
        fetchDashboard();
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [loading, isAuthenticated]);

  const stats = useMemo(() => {
    const totals = {
      ballots: summary.length,
      active: summary.filter((entry) => entry.status === "ACTIVE").length,
      voters: summary.reduce((sum, entry) => sum + entry.voterCount, 0),
      votes: summary.reduce((sum, entry) => sum + entry.votesReceived, 0),
    };

    return totals;
  }, [summary]);

  if (loading || loadingData) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="skeleton h-8 w-52 mb-4" />
          <div className="skeleton h-4 w-72 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, idx) => (
              <div key={idx} className="skeleton h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="skeleton h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8 w-full">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <p className="text-eyebrow mb-2">Admin dashboard</p>
            <h1 className="text-3xl font-space-grotesk font-bold text-ink-primary">
              Ballot operations
            </h1>
            {orgName && (
              <p className="text-base text-ink-muted mt-1">{orgName}</p>
            )}
          </div>

          <Link to="/ballots/new" className="btn-primary" style={{ minHeight: "48px" }}>
            + Create Ballot
          </Link>
        </div>

        {error && (
          <div className="message message-error mb-6">
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <div className="card p-5">
            <p className="text-sm text-ink-muted">Total ballots</p>
            <p className="text-3xl font-space-grotesk font-bold mt-2">{stats.ballots}</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-ink-muted">Active</p>
            <p className="text-3xl font-space-grotesk font-bold mt-2">{stats.active}</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-ink-muted">Eligible voters</p>
            <p className="text-3xl font-space-grotesk font-bold mt-2">{stats.voters}</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-ink-muted">Votes cast</p>
            <p className="text-3xl font-space-grotesk font-bold mt-2">{stats.votes}</p>
          </div>
        </div>

        <div className="card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-space-grotesk font-bold text-ink-primary">Live ballot summary</h2>
            <button className="btn-ghost" onClick={fetchDashboard} type="button">
              Refresh
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  <th className="py-3 pr-4 text-ink-muted">Ballot</th>
                  <th className="py-3 pr-4 text-ink-muted">Status</th>
                  <th className="py-3 pr-4 text-ink-muted">Voters</th>
                  <th className="py-3 pr-4 text-ink-muted">Tokens</th>
                  <th className="py-3 pr-4 text-ink-muted">Votes</th>
                  <th className="py-3 pr-4 text-ink-muted">Tally</th>
                  <th className="py-3 text-ink-muted">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-ink-muted">
                      No ballots have been created yet.
                    </td>
                  </tr>
                ) : (
                  summary.map((ballot) => (
                    <tr key={ballot.id} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          className="text-left font-medium underline-offset-2 hover:underline"
                          style={{ color: "var(--ink-primary)" }}
                          onClick={() => navigate(`/ballots/${ballot.id}/edit`)}
                        >
                          {ballot.topic}
                        </button>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="px-2 py-1 rounded-full text-xs font-medium"
                          style={{
                            background: `${statusStyles[ballot.status] || "var(--ink-muted)"}20`,
                            color: statusStyles[ballot.status] || "var(--ink-muted)",
                            border: `1px solid ${statusStyles[ballot.status] || "var(--ink-muted)"}`,
                          }}
                        >
                          {ballot.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4">{ballot.voterCount}</td>
                      <td className="py-3 pr-4">{ballot.tokensIssued}</td>
                      <td className="py-3 pr-4">{ballot.votesReceived}</td>
                      <td className="py-3 pr-4">{ballot.tallyStatus}</td>
                      <td className="py-3">
                        {new Date(ballot.deadline).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {ballots.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-space-grotesk font-bold mb-4 text-ink-primary">Management actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ballots.slice(0, 6).map((ballot) => (
                <div key={ballot.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-ink-primary">{ballot.topic}</p>
                      <p className="text-xs text-ink-muted mt-1">{ballot.status}</p>
                    </div>
                    <span
                      className="px-2 py-1 rounded-full text-[10px] font-medium"
                      style={{
                        background: `${statusStyles[ballot.status] || "var(--ink-muted)"}20`,
                        color: statusStyles[ballot.status] || "var(--ink-muted)",
                        border: `1px solid ${statusStyles[ballot.status] || "var(--ink-muted)"}`,
                      }}
                    >
                      {ballot.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => navigate(`/ballots/${ballot.id}/edit`)}
                    >
                      Edit
                    </button>
                    {ballot.status === "ACTIVE" && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => navigate(`/results/${ballot.id}`)}
                      >
                        View results
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => navigate(`/audit/${ballot.id}`)}
                    >
                      Audit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
