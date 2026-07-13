import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAdminBallots, getAdminAudit } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import Navbar from "../components/Navbar";
import BallotCard from "../components/BallotCard";
import OrganizationOverview from "../components/OrganizationOverview";
import type { Ballot } from "../types";
import {
  ClipboardIcon,
  LightningBoltIcon,
  CheckCircledIcon,
} from "@radix-ui/react-icons";

export default function DashboardPage() {
  const { isAuthenticated, loading: authLoading, orgName } = useAuth();
  const navigate = useNavigate();
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<
    "ALL" | "DRAFT" | "OPEN" | "CLOSED"
  >("ALL");

  const fetchBallots = async () => {
    try {
      const res = await getAdminBallots();
      setBallots(res.data.data);
    } catch {
      // 401 handled by interceptor
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/login");
      return;
    }
    if (!authLoading) fetchBallots();
  }, [authLoading, isAuthenticated]);

  // Auto-refresh every 60s — moved BEFORE conditional return
  useEffect(() => {
    const interval = setInterval(fetchBallots, 60_000);
    return () => clearInterval(interval);
  }, []);

  const downloadAudit = async (ballotId: string, format: "json" | "csv") => {
    try {
      const res = await getAdminAudit(ballotId, format);
      const blob = new Blob([res.data as BlobPart], {
        type: format === "csv" ? "text/csv" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${ballotId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Errors handled by interceptor
    }
  };

  if (authLoading) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div
          style={{
            padding: "var(--space-8)",
            maxWidth: "1200px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          <div
            className="skeleton"
            style={{
              height: "40px",
              width: "280px",
              marginBottom: "var(--space-8)",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              marginBottom: "var(--space-8)",
            }}
          >
            <div className="skeleton" style={{ height: "100px", flex: 1 }} />
            <div className="skeleton" style={{ height: "100px", flex: 1 }} />
            <div className="skeleton" style={{ height: "100px", flex: 1 }} />
          </div>
          <div
            className="skeleton"
            style={{ height: "200px", width: "100%" }}
          />
        </div>
      </div>
    );
  }

  const filteredBallots = ballots.filter((b) => {
    const matchesSearch = b.topic.toLowerCase().includes(search.toLowerCase());
    const matchesTab = activeTab === "ALL" || b.status === activeTab;
    return matchesSearch && matchesTab;
  });

  const closedBallots = ballots.filter((b) => b.status === "CLOSED");

  return (
    <div className="page-wrapper">
      <Navbar />
      <div
        style={{
          padding: "var(--space-8) 0",
          maxWidth: "1200px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-space-grotesk font-bold mb-1">
              Dashboard
            </h1>
            {orgName && (
              <p className="text-lg" style={{ color: "var(--ink-secondary)" }}>
                {orgName}
              </p>
            )}
          </div>
          <Link
            to="/ballots/new"
            className="btn-primary"
            style={{ minHeight: "48px", padding: "8px 16px" }}
          >
            + Create Ballot
          </Link>
        </div>

        {/* Organization Overview Card */}
        <OrganizationOverview organizationName={orgName} />

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-dm-sans"
                style={{ color: "var(--ink-muted)" }}
              >
                Total Ballots
              </span>
              <ClipboardIcon
                className="w-6 h-6"
                style={{ color: "var(--ink-muted)" }}
              />
            </div>
            <p
              className="text-3xl font-space-grotesk font-bold"
              style={{ color: "var(--ink-primary)" }}
            >
              {ballots.length}
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-dm-sans"
                style={{ color: "var(--ink-muted)" }}
              >
                Active Ballots
              </span>
              <LightningBoltIcon
                className="w-6 h-6"
                style={{ color: "var(--semantic-success)" }}
              />
            </div>
            <p
              className="text-3xl font-space-grotesk font-bold"
              style={{ color: "var(--ink-primary)" }}
            >
              {ballots.filter((b) => b.status === "OPEN").length}
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-dm-sans"
                style={{ color: "var(--ink-muted)" }}
              >
                Total Votes Cast
              </span>
              <CheckCircledIcon
                className="w-6 h-6"
                style={{ color: "var(--brand-primary)" }}
              />
            </div>
            <p
              className="text-3xl font-space-grotesk font-bold"
              style={{ color: "var(--ink-primary)" }}
            >
              {ballots.reduce((sum, b) => sum + (b.votesCast || 0), 0)}
            </p>
          </div>
        </div>

        {ballots.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-lg mb-4" style={{ color: "var(--ink-muted)" }}>
              No ballots yet.
            </p>
            <Link to="/ballots/new" className="link-dark">
              Create your first ballot →
            </Link>
          </div>
        ) : (
          <div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
              <div
                className="flex p-1 bg-surface-sunken rounded-lg"
                style={{ background: "var(--surface-sunken)" }}
              >
                {(["ALL", "DRAFT", "OPEN", "CLOSED"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeTab === tab
                        ? "bg-white shadow-sm text-brand-primary"
                        : "text-ink-muted hover:text-ink-primary"
                    }`}
                    style={
                      activeTab === tab
                        ? {
                            background: "var(--surface-base)",
                            color: "var(--brand-primary)",
                          }
                        : {}
                    }
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div
                className="input-wrapper"
                style={{ maxWidth: "300px", width: "100%" }}
              >
                <span className="input-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Search ballots..."
                  className="input-field has-icon"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {filteredBallots.length === 0 ? (
              <div className="text-center py-12 card bg-surface-sunken">
                <p style={{ color: "var(--ink-muted)" }}>
                  No ballots matching your filters.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredBallots.map((b) => (
                  <BallotCard
                    key={b.id}
                    ballot={b}
                    onBallotDeleted={fetchBallots}
                  />
                ))}
              </div>
            )}

            {/* Audit Export Panel — closed ballots only */}
            {closedBallots.length > 0 && (
              <div style={{ marginTop: "var(--space-10)" }}>
                <h3
                  className="font-body font-semibold mb-3"
                  style={{
                    fontSize: "var(--text-xl)",
                    color: "var(--ink-primary)",
                  }}
                >
                  Audit Exports
                </h3>
                <div className="card p-4">
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    <thead>
                      <tr
                        style={{ borderBottom: "1px solid var(--border-soft)" }}
                      >
                        <th
                          style={{
                            textAlign: "left",
                            padding: "var(--space-2) var(--space-3)",
                            color: "var(--ink-muted)",
                            fontWeight: "var(--weight-medium)",
                          }}
                        >
                          Ballot
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: "var(--space-2) var(--space-3)",
                            color: "var(--ink-muted)",
                            fontWeight: "var(--weight-medium)",
                          }}
                        >
                          Export
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedBallots.map((b) => (
                        <tr
                          key={b.id}
                          style={{
                            borderBottom: "1px solid var(--border-soft)",
                          }}
                        >
                          <td
                            style={{
                              padding: "var(--space-3)",
                              color: "var(--ink-primary)",
                            }}
                          >
                            {b.topic}
                          </td>
                          <td
                            style={{
                              padding: "var(--space-3)",
                              textAlign: "right",
                            }}
                          >
                            <div
                              style={{
                                display: "inline-flex",
                                gap: "var(--space-2)",
                              }}
                            >
                              <button
                                id={`export-json-${b.id}`}
                                onClick={() => downloadAudit(b.id, "json")}
                                className="btn-secondary"
                                style={{
                                  fontSize: "var(--text-xs)",
                                  padding: "4px 10px",
                                }}
                              >
                                JSON
                              </button>
                              <button
                                id={`export-csv-${b.id}`}
                                onClick={() => downloadAudit(b.id, "csv")}
                                className="btn-secondary"
                                style={{
                                  fontSize: "var(--text-xs)",
                                  padding: "4px 10px",
                                }}
                              >
                                CSV
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
