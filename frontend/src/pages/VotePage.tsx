import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckIcon, ChevronLeftIcon, InfoCircledIcon, KeyboardIcon, LockClosedIcon, ReloadIcon } from "@radix-ui/react-icons";
import { getBallot, submitVote } from "../api/client";
import Navbar from "../components/Navbar";
import OptionSelector from "../components/OptionSelector";
import type { Ballot } from "../types";

const TOKEN_RE = /^[0-9a-f]{32,}$/i;

function isValidTokenFormat(raw: string): boolean {
  return TOKEN_RE.test(raw.trim());
}

function resolveErrorMessage(err: any): { message: string; isNetwork: boolean } {
  if (!err.response) {
    return {
      message: "Unable to reach the server. Check your connection and try again.",
      isNetwork: true,
    };
  }

  const status = err.response.status;
  const code = err.response.data?.error ?? "";

  if (status === 409 || code === "AlreadyVoted" || code === "TOKEN_ALREADY_USED") {
    return {
      message: "This token has already voted. Each token can only be used once.",
      isNetwork: false,
    };
  }

  if (status === 401 || code === "INVALID_TOKEN") {
    return {
      message: "This token is not valid for this ballot.",
      isNetwork: false,
    };
  }

  if (status === 403 || code === "BALLOT_CLOSED") {
    return {
      message: "Voting for this ballot has closed.",
      isNetwork: false,
    };
  }

  if (status === 429 || code === "RATE_LIMIT_EXCEEDED") {
    const retryAfter = err.response.headers?.["retry-after"];
    const seconds = retryAfter ? ` Try again in ${retryAfter} seconds.` : "";
    return {
      message: `Too many attempts.${seconds}`,
      isNetwork: false,
    };
  }

  if (status === 400) {
    return {
      message: err.response.data?.message ?? "Invalid request. Please check your token and selection.",
      isNetwork: false,
    };
  }

  return {
    message: err.response.data?.message ?? "Failed to submit vote. Please try again.",
    isNetwork: false,
  };
}

export default function VotePage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  const [token, setToken] = useState<string>((location.state as any)?.token ?? "");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [selectedOption, setSelectedOption] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [tokenInlineError, setTokenInlineError] = useState("");
  const [error, setError] = useState("");
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [voteId, setVoteId] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [fetchError, setFetchError] = useState("");
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ballotId) return;

    getBallot(ballotId)
      .then((res) => {
        const ballotData = res.data.data;
        const isOpen = ballotData.status === "OPEN" || ballotData.status === "ACTIVE";
        if (!isOpen) {
          setBallotError("This ballot is not currently accepting votes.");
          return;
        }
        setBallot(ballotData);
      })
      .catch(() => {
        setFetchError("This ballot is not available or could not be loaded.");
      });
  }, [ballotId]);

  useEffect(() => {
    if (!success) return;
    let secs = 3;
    setCountdown(secs);
    const interval = setInterval(() => {
      secs -= 1;
      setCountdown(secs);
      if (secs <= 0) {
        clearInterval(interval);
        navigate(`/results/${ballotId}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [success, ballotId, navigate]);

  useEffect(() => () => {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
  }, []);

  const tokenValid = isValidTokenFormat(token);
  const hasSelection = !!selectedOption;
  const canSubmit = tokenValid && hasSelection && confirmed && !loading;
  const showTokenError = tokenTouched && token.trim().length > 0 && !tokenValid;

  useEffect(() => {
    if (!token) {
      setTokenInlineError("");
      return;
    }
    if (tokenTouched && !isValidTokenFormat(token)) {
      setTokenInlineError("Invalid token format. Token must be a 64-character hexadecimal string.");
    } else {
      setTokenInlineError("");
    }
  }, [token, tokenTouched]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !ballotId) return;

    setError("");
    setIsNetworkError(false);
    setLoading(true);

    try {
      const result = await submitVote({
        ballotId: ballotId,
        voterToken: token.trim(),
        optionId: selectedOption,
        weight: 1,
      });

      setVoteId(result.data.data.voteId || "");
      setToken("");
      setSuccess(true);
    } catch (err: any) {
      const { message, isNetwork } = resolveErrorMessage(err);
      setError(message);
      setIsNetworkError(isNetwork);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setError("");
    setIsNetworkError(false);
  };

  if (success) {
    return (
      <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="card p-8 text-center space-y-6" data-testid="success-screen">
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "var(--semantic-success-bg, #dcfce7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto",
              }}
            >
              <CheckIcon width="32" height="32" style={{ color: "var(--semantic-success, #16a34a)" }} />
            </div>

            <div>
              <h2 className="font-space-grotesk font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--semantic-success, #16a34a)", marginBottom: "var(--space-2)" }}>
                Vote Submitted
              </h2>
              <p style={{ color: "var(--ink-secondary)", fontSize: "var(--text-base)" }}>
                Your vote has been recorded and encrypted.
              </p>
              <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>
                Your anonymity is preserved — your identity is never linked to your choice.
              </p>
            </div>

            {voteId && (
              <div className="card" style={{ padding: "var(--space-4)", background: "var(--semantic-success-bg, #f0fdf4)", border: "1px solid var(--semantic-success-border, #bbf7d0)" }}>
                <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "var(--space-1)", fontFamily: "var(--font-mono)" }}>
                  Vote ID (for your records)
                </p>
                <p className="font-mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-primary)", wordBreak: "break-all" }}>
                  {voteId}
                </p>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <Link to={`/results/${ballotId}`} className="btn-primary" style={{ textAlign: "center" }} aria-label="View results now">
                View Results
              </Link>
              <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}>
                Redirecting to results in {countdown} second{countdown !== 1 ? "s" : ""}…
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (ballotError) {
    return (
      <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="card p-8 text-center space-y-4">
            <p style={{ color: "var(--ink-secondary)" }}>{ballotError}</p>
            <Link to={`/vote/${ballotId}/token`} style={{ color: "var(--brand-primary)", fontSize: "var(--text-sm)" }} data-testid="back-link">
              ← Back to Ballot
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (fetchError || !ballot) {
    return (
      <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="card p-8 text-center">
            <p className="text-red-600 dark:text-red-400 font-medium">{fetchError || "Loading ballot..."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Cast Your Vote</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Your vote is encrypted before being stored. No link to your identity exists.
          </p>
        </div>

        <div className="card p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm space-y-2">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Ballot Topic
          </span>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{ballot.topic}</h2>
        </div>

        {error && (
          <div className="message message-error" role="alert" aria-live="assertive" data-testid="error-banner">
            <span className="message-icon" aria-hidden="true">
              <InfoCircledIcon width="16" height="16" />
            </span>
            <span style={{ flex: 1 }}>{error}</span>
            {isNetworkError && (
              <button type="button" onClick={handleRetry} className="btn-ghost" aria-label="Retry submission" data-testid="retry-button" style={{ marginLeft: "var(--space-3)", padding: "var(--space-1) var(--space-3)", fontSize: "var(--text-sm)", display: "inline-flex", alignItems: "center", gap: "var(--space-1)", minHeight: "unset" }}>
                <ReloadIcon width="14" height="14" />
                Retry
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div>
            <label htmlFor="voter-token" className="block text-sm font-medium mb-1" style={{ color: "var(--ink-secondary)" }}>
              Your Voting Token
              <span aria-hidden="true" style={{ color: "var(--semantic-error)" }}> *</span>
            </label>
            <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)", marginBottom: "var(--space-2)" }}>
              The one-time token you received when you registered to vote.
            </p>
            <div className="input-wrapper">
              <span className="input-icon" aria-hidden="true">
                <KeyboardIcon />
              </span>
              <input
                id="voter-token"
                type="text"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError("");
                  setIsNetworkError(false);
                }}
                onBlur={() => setTokenTouched(true)}
                className="input-field has-icon font-mono text-sm"
                placeholder="Paste your token here"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-required="true"
                aria-label="Voting token"
                aria-invalid={showTokenError}
                aria-describedby={showTokenError ? "token-format-error" : undefined}
                data-testid="token-input"
              />
            </div>
            {showTokenError && (
              <p id="token-format-error" role="alert" style={{ color: "var(--semantic-error)", fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }} data-testid="token-inline-error">
                Invalid token format. Token must be a 64-character hexadecimal string.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: "var(--ink-secondary)" }} id="option-label">
              Select an Option
              <span aria-hidden="true" style={{ color: "var(--semantic-error)" }}> *</span>
            </label>
            <OptionSelector
              options={ballot.options}
              selected={selectedOption}
              onChange={(id) => {
                setSelectedOption(id);
                setError("");
                setIsNetworkError(false);
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", cursor: "pointer", padding: "var(--space-4)", borderRadius: "var(--radius-md)", border: `1px solid ${confirmed ? "var(--brand-primary)" : "var(--border-soft)"}`, background: confirmed ? "var(--brand-primary-pale)" : "var(--surface-sunken)", transition: "border-color var(--transition-fast), background var(--transition-fast)" }} data-testid="confirm-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              aria-label="I understand my vote is final and cannot be changed"
              data-testid="confirm-checkbox"
              style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "var(--brand-primary)", flexShrink: 0 }}
            />
            <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
              <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--ink-primary)" }}>I understand my vote is final.</span>{" "}
              Once submitted, votes cannot be changed or retracted. My token will be marked as used.
            </span>
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full btn-primary"
            aria-label="Submit your vote"
            aria-disabled={!canSubmit}
            data-testid="submit-button"
            style={{ minHeight: "52px", fontSize: "var(--text-base)" }}
          >
            {loading ? (
              <span className="loading-dots" aria-label="Submitting vote…">
                <span></span>
                <span></span>
                <span></span>
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                <LockClosedIcon width="16" height="16" />
                Cast Vote — This cannot be undone
              </span>
            )}
          </button>

          <div style={{ textAlign: "center" }}>
            <Link to={`/vote/${ballotId}/token`} style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)", display: "inline-flex", alignItems: "center", gap: "var(--space-1)", textDecoration: "none" }} aria-label="Go back to ballot" data-testid="back-link">
              <ChevronLeftIcon width="14" height="14" />
              Back to Ballot
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
