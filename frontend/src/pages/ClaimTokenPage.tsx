/**
 * ClaimTokenPage — /ballot/:ballotId/claim-token
 *
 * Voter landing page linked from email invitations.
 * The voter's email is pre-populated from the `?email=` query parameter.
 * On load the token request is submitted automatically so voters only need
 * one click to go from their email to their voting token.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { getBallot, requestToken } from "../api/client";
import Navbar from "../components/Navbar";
import TokenDisplay from "../components/TokenDisplay";
import type { Ballot } from "../types";
import {
  InfoCircledIcon,
  PersonIcon,
} from "@radix-ui/react-icons";

type PageState = "loading" | "form" | "token" | "already_voted" | "error";

export default function ClaimTokenPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const prefillEmail = searchParams.get("email") ?? "";

  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [token, setToken] = useState("");
  const [identifier, setIdentifier] = useState(prefillEmail);
  const [error, setError] = useState("");
  const [pageState, setPageState] = useState<PageState>(
    prefillEmail ? "loading" : "form",
  );

  // Fetch ballot details
  useEffect(() => {
    if (!ballotId) return;
    getBallot(ballotId).catch(() => {
      setError("This ballot is not available.");
      setPageState("error");
    });

    getBallot(ballotId).then((res) => {
      const b = res.data.data;
      setBallot(b);
      if (b.status !== "OPEN") {
        setError("This ballot is not currently accepting votes.");
        setPageState("error");
      } else if (prefillEmail) {
        // Auto-claim when email is pre-filled from the invite link
        claimToken(prefillEmail, b);
      } else {
        setPageState("form");
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballotId]);

  async function claimToken(email: string, b: Ballot) {
    setError("");
    setPageState("loading");
    try {
      const res = await requestToken({
        ballotId: b.id,
        voterIdentifier: email.trim(),
      });
      setToken(res.data.data.token);
      setPageState("token");
    } catch (err: any) {
      const errorCode = err?.response?.data?.error ?? "";
      const serverMsg = err?.response?.data?.message ?? "";

      if (errorCode === "AlreadyVoted") {
        setPageState("already_voted");
      } else if (errorCode === "TokenAlreadyIssued") {
        // Token already issued — send to the full token-request page where
        // they can either paste their token or request a reissue
        navigate(`/vote/${b.id}/token`);
      } else {
        setError(
          serverMsg ||
            "Unable to issue a token. Please verify your email and try again.",
        );
        setPageState("form");
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setError("Please enter your email address");
      return;
    }
    if (ballot) claimToken(identifier, ballot);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

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
        <div className="section-eyebrow mb-2">Claim Your Voting Token</div>
        <h1 className="text-3xl font-space-grotesk font-bold mb-2">
          Claim Your Voting Token
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-8">
          You've been invited to vote. Claim your anonymous token to participate.
        </p>

        {/* Ballot info card */}
        {ballot && (
          <div className="card p-4 mb-6">
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
        )}

        {/* Loading state */}
        {pageState === "loading" && (
          <div className="card p-8">
            <div className="animate-pulse space-y-4">
              <div
                style={{
                  height: "20px",
                  background: "var(--surface-sunken)",
                  borderRadius: "var(--radius-sm)",
                }}
              />
              <div
                style={{
                  height: "20px",
                  background: "var(--surface-sunken)",
                  borderRadius: "var(--radius-sm)",
                  width: "60%",
                }}
              />
            </div>
            <p
              style={{
                color: "var(--ink-muted)",
                fontSize: "var(--text-sm)",
                marginTop: "var(--space-4)",
                textAlign: "center",
              }}
            >
              Claiming your token…
            </p>
          </div>
        )}

        {/* Token display */}
        {pageState === "token" && token && (
          <TokenDisplay token={token} ballotId={ballotId!} />
        )}

        {/* Already voted */}
        {pageState === "already_voted" && (
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
              Your token was used to vote on{" "}
              <strong>"{ballot?.topic}"</strong>. Each voter can only vote once.
            </p>
            <p
              style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)" }}
            >
              If you believe this is an error, please contact your
              administrator.
            </p>
          </div>
        )}

        {/* Error state */}
        {pageState === "error" && (
          <div className="card p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">{error}</p>
          </div>
        )}

        {/* Manual form (no prefill or auto-claim failed) */}
        {pageState === "form" && (
          <div className="card p-6 space-y-6">
            {error && (
              <div
                id="claim-error"
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
                <label
                  htmlFor="claim-email"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Your Email Address
                </label>
                <p className="text-gray-500 text-xs mb-2">
                  Enter the email address your administrator used to register
                  you as an eligible voter.
                </p>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <PersonIcon />
                  </span>
                  <input
                    id="claim-email"
                    type="email"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-field has-icon"
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-required="true"
                    aria-label="Your email address"
                    aria-invalid={!!error}
                    aria-describedby={error ? "claim-error" : undefined}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full btn-primary"
                aria-label="Claim my voting token"
              >
                Claim My Token →
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
