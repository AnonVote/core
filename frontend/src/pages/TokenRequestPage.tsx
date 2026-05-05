import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getBallot, requestToken, reissueToken } from "../api/client";
import Navbar from "../components/Navbar";
import TokenDisplay from "../components/TokenDisplay";
import type { Ballot } from "../types";

type PageState = "form" | "lost_token" | "vote_already_cast";

export default function TokenRequestPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageState, setPageState] = useState<PageState>("form");

  useEffect(() => {
    if (!ballotId) return;
    getBallot(ballotId)
      .then((res) => {
        const b = res.data.data;
        if (b.status !== "OPEN")
          setBallotError(
            "This ballot is not currently accepting token requests.",
          );
        else setBallot(b);
      })
      .catch(() => setBallotError("This ballot is not available."));
  }, [ballotId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setError("Please enter your voter identifier");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await requestToken({
        ballotId: ballotId!,
        voterIdentifier: identifier.trim(),
      });
      setToken(res.data.data.token);
    } catch (err: any) {
      const errorCode = err?.response?.data?.error || "";
      const serverMsg = err?.response?.data?.message || "";

      if (errorCode === "AlreadyVoted") {
        setPageState("vote_already_cast");
      } else if (errorCode === "TokenAlreadyIssued") {
        setPageState("lost_token");
      } else {
        setError(
          serverMsg ||
            "Unable to issue token. Please verify your identifier and try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReissue = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await reissueToken({
        ballotId: ballotId!,
        voterIdentifier: identifier.trim(),
      });
      setToken(res.data.data.token);
      setPageState("form");
    } catch (err: any) {
      const errorCode = err?.response?.data?.error || "";
      const serverMsg = err?.response?.data?.message || "";
      if (errorCode === "AlreadyVoted") {
        setPageState("vote_already_cast");
      } else {
        setError(serverMsg || "Unable to reissue token. Please try again.");
        setPageState("form");
      }
    } finally {
      setLoading(false);
    }
  };

  const ballotInfo = ballot && (
    <div className="card p-4">
      <p className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1 font-mono">
        Ballot
      </p>
      <p className="text-gray-900 dark:text-white font-semibold">
        {ballot.topic}
      </p>
      <p className="text-gray-500 text-sm mt-1">
        Closes: {new Date(ballot.deadline).toLocaleString()}
      </p>
    </div>
  );

  return (
    <div className="page-wrapper">
      <Navbar />
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "var(--space-10) var(--space-6)",
          width: "100%",
        }}
      >
        <div className="section-eyebrow mb-2">Get Your Voting Token</div>
        <h1 className="text-3xl font-space-grotesk font-bold mb-2">
          Get Your Voting Token
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-8">
          Enter your identifier to receive a one-time anonymous voting token.
        </p>

        {ballotError ? (
          <div className="card p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">{ballotError}</p>
          </div>
        ) : !ballot ? (
          <div className="card p-8 animate-pulse h-48" />
        ) : token ? (
          <TokenDisplay token={token} ballotId={ballotId!} />
        ) : pageState === "vote_already_cast" ? (
          /* ── Vote already cast ── */
          <div className="card p-8 text-center space-y-4">
            <div style={{ fontSize: "2.5rem" }}>🗳️</div>
            <h2
              className="font-space-grotesk font-semibold"
              style={{
                color: "var(--ink-primary)",
                fontSize: "var(--text-lg)",
              }}
            >
              Your vote has already been cast
            </h2>
            <p
              style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}
            >
              Your previous token was used to vote on{" "}
              <strong>"{ballot.topic}"</strong>. Each voter can only vote once.
            </p>
            <p
              style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)" }}
            >
              If you believe this is an error, please contact your
              administrator.
            </p>
          </div>
        ) : pageState === "lost_token" ? (
          /* ── Lost token prompt ── */
          <div className="card p-6 space-y-6">
            {ballotInfo}
            <div className="message message-warning">
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
              <span>A token was already issued for this identifier.</span>
            </div>

            <div
              style={{
                color: "var(--ink-secondary)",
                fontSize: "var(--text-sm)",
              }}
            >
              <p style={{ marginBottom: "var(--space-2)" }}>
                Did you lose your token? You can request a replacement.
              </p>
              <p
                style={{
                  color: "var(--ink-muted)",
                  fontSize: "var(--text-xs)",
                }}
              >
                Your old token will be revoked and a new one issued — but only
                if you haven't voted yet.
              </p>
            </div>

            {error && (
              <div className="message message-error">
                <span className="message-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </span>
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button
                onClick={() => {
                  setPageState("form");
                  setError("");
                }}
                className="btn-ghost"
                style={{ flex: 1, minHeight: "48px" }}
              >
                Back
              </button>
              <button
                onClick={handleReissue}
                disabled={loading}
                className="btn-primary"
                style={{ flex: 2, minHeight: "48px" }}
              >
                {loading ? (
                  <span className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                ) : (
                  "Yes, send me a new token"
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── Default form ── */
          <div className="card p-6 space-y-6">
            {ballotInfo}

            {error && (
              <div className="message message-error">
                <span className="message-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Your Voter Identifier
                </label>
                <p className="text-gray-500 text-xs mb-2">
                  e.g. your email address or employee ID as provided by your
                  administrator
                </p>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-field has-icon"
                    placeholder="your.email@example.com"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary"
              >
                {loading ? (
                  <span className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                ) : (
                  "Get My Token"
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
