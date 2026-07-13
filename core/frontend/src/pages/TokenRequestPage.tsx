import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getBallot, requestToken, reissueToken } from "../api/client";
import Navbar from "../components/Navbar";
import TokenDisplay from "../components/TokenDisplay";
import type { Ballot } from "../types";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
  KeyboardIcon,
  PersonIcon,
} from "@radix-ui/react-icons";

type PageState = "form" | "lost_token" | "vote_already_cast";

export default function TokenRequestPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
  const [existingToken, setExistingToken] = useState(""); // for "I still have my token" input
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageState, setPageState] = useState<PageState>("form");
  const navigate = useNavigate();

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
          padding: "var(--space-10) 0",
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
                <ExclamationTriangleIcon width="16" height="16" />
              </span>
              <span>A token was already issued for this identifier.</span>
            </div>

            {/* Option 1 — still have the token */}
            <div>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--ink-primary)",
                  marginBottom: "var(--space-2)",
                }}
              >
                Still have your token?
              </p>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Paste it below and go straight to voting.
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <div className="input-wrapper" style={{ flex: 1 }}>
                  <span className="input-icon">
                    <KeyboardIcon />
                  </span>
                  <input
                    type="text"
                    value={existingToken}
                    onChange={(e) => setExistingToken(e.target.value)}
                    className="input-field has-icon font-mono"
                    placeholder="Paste your token here"
                    aria-label="Your existing voting token"
                    style={{ fontSize: "var(--text-sm)" }}
                  />
                </div>
                <button
                  onClick={() => {
                    if (existingToken.trim()) {
                      navigate(`/vote/${ballotId}`, {
                        state: { token: existingToken.trim() },
                      });
                    }
                  }}
                  disabled={!existingToken.trim()}
                  className="btn-primary"
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    fontSize: "var(--text-sm)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Proceed to Vote →
                </button>
              </div>
            </div>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: "1px",
                  background: "var(--border-soft)",
                }}
              />
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                or if you lost it
              </span>
              <div
                style={{
                  flex: 1,
                  height: "1px",
                  background: "var(--border-soft)",
                }}
              />
            </div>

            {/* Option 2 — request a new token */}
            <div>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--ink-primary)",
                  marginBottom: "var(--space-1)",
                }}
              >
                Lost your token?
              </p>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Your old token will be revoked and a new one issued — only if
                you haven't voted yet.
              </p>

              {error && (
                <div
                  className="message message-error"
                  role="alert"
                  aria-live="assertive"
                  style={{ marginBottom: "var(--space-3)" }}
                >
                  <span className="message-icon" aria-hidden="true">
                    <InfoCircledIcon width="16" height="16" />
                  </span>
                  <span>{error}</span>
                </div>
              )}

              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <button
                  onClick={() => {
                    setPageState("form");
                    setError("");
                    setExistingToken("");
                  }}
                  className="btn-ghost"
                  aria-label="Go back to identifier form"
                  style={{ flex: 1, minHeight: "48px" }}
                >
                  Back
                </button>
                <button
                  onClick={handleReissue}
                  disabled={loading}
                  className="btn-primary"
                  aria-label="Request a replacement token"
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
          </div>
        ) : (
          /* ── Default form ── */
          <div className="card p-6 space-y-6">
            {ballotInfo}

            {error && (
              <div
                id="token-error"
                className="message message-error"
                role="alert"
                aria-live="assertive"
              >
                <span className="message-icon" aria-hidden="true">
                  <InfoCircledIcon width="16" height="16" />
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
                    <PersonIcon />
                  </span>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-field has-icon"
                    placeholder="your.email@example.com"
                    aria-required="true"
                    aria-label="Voter identifier"
                    aria-invalid={!!error}
                    aria-describedby={error ? "token-error" : undefined}
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
