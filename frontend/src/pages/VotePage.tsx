import { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { getBallot, submitVote } from "../api/client";
import Navbar from "../components/Navbar";
import OptionSelector from "../components/OptionSelector";
import type { Ballot } from "../types";
import {
  CheckIcon,
  InfoCircledIcon,
  KeyboardIcon,
  LockClosedIcon,
  ReloadIcon,
  ChevronLeftIcon,
} from "@radix-ui/react-icons";
import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import VoteConfirmation from "../components/VoteConfirmation";
import VoteError, { VoteErrorCode } from "../components/VoteError";
import { getBallot, submitVote } from "../api/client";
import type { Ballot, Option } from "../types";

// ── Client-side token validation ─────────────────────────────────────────────

/** Tokens are hex-encoded — at least 32 hex characters. */
const TOKEN_RE = /^[0-9a-f]{32,}$/i;

function isValidTokenFormat(raw: string): boolean {
  return TOKEN_RE.test(raw.trim());
}

// ── Error code → user-friendly message map ────────────────────────────────────

function resolveErrorMessage(err: any): { message: string; isNetwork: boolean } {
  if (!err.response) {
    // No response at all — network / timeout error
    return {
      message: "Unable to reach the server. Check your connection and try again.",
      isNetwork: true,
    };
  }

  const status: number = err.response.status;
  const code: string = err.response.data?.error ?? "";

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function VotePage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");

  // Pre-fill token when navigated from TokenDisplay / ClaimTokenPage
  const [token, setToken] = useState<string>((location.state as any)?.token ?? "");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [selectedOption, setSelectedOption] = useState("");
  const [rankedOptions, setRankedOptions] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  const [error, setError] = useState("");
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [voteId, setVoteId] = useState("");

  // Countdown ref for auto-redirect
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [countdown, setCountdown] = useState(3);

  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [token, setToken] = useState<string>(
    (location.state as any)?.token || ""
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string>("");
  const [tokenInlineError, setTokenInlineError] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [submissionResult, setSubmissionResult] = useState<{
    stellar_tx_id?: string | null;
    anchor_status?: string;
    explorer_url?: string;
  } | null>(null);

  const [errorCode, setErrorCode] = useState<VoteErrorCode | null>(null);
  const [fetchError, setFetchError] = useState<string>("");

  useEffect(() => {
    if (!ballotId) return;
    getBallot(ballotId)
      .then((res) => {
        const b = res.data.data;
        if (b.status !== "OPEN") setBallotError("This ballot is not currently accepting votes.");
        else setBallot(b);
        if (b.status !== "OPEN") {
          setErrorCode("BALLOT_CLOSED");
        } else {
          setBallot(b);
        }
      })
      .catch(() => {
        setFetchError("This ballot is not available or could not be loaded.");
      });
  }, [ballotId]);

  // Auto-redirect to results 3 seconds after a successful vote
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

  // Cleanup redirect timer on unmount
  useEffect(() => () => { if (redirectTimer.current) clearTimeout(redirectTimer.current); }, []);

  // ── Ranked-choice helpers ──────────────────────────────────────────────────

  const toggleRankedOption = (optionId: string) => {
    setError("");
    if (rankedOptions.includes(optionId)) {
      setRankedOptions(rankedOptions.filter((id) => id !== optionId));
    } else {
      if (ballot?.maxRankings && rankedOptions.length >= ballot.maxRankings) {
        setError(`You can only rank up to ${ballot.maxRankings} options.`);
        return;
      }
      setRankedOptions([...rankedOptions, optionId]);
    }
  };

  // ── Derived validation state ───────────────────────────────────────────────

  const tokenValid = isValidTokenFormat(token);
  const hasSelection = ballot?.allowRankedChoice ? rankedOptions.length > 0 : selectedOption !== "";
  const canSubmit = tokenValid && hasSelection && confirmed && !loading;

  const showTokenError = tokenTouched && token.trim().length > 0 && !tokenValid;

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setIsNetworkError(false);
    setLoading(true);

    try {
      const voteData: Parameters<typeof submitVote>[0] = {
        ballotId: ballotId!,
        voterToken: token.trim(),
        optionId: rankedOptions.length > 0 ? rankedOptions[0] : selectedOption,
        weight: 1,
      };

      const result = await submitVote(voteData);

      // Clear token from state immediately after use — never keep it around
      setToken("");
      setVoteId(result.data.data.voteId);
      setSuccess(true);
    } catch (err: any) {
      const { message, isNetwork } = resolveErrorMessage(err);
      setError(message);
      setIsNetworkError(isNetwork);
  const validateTokenFormat = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
      setTokenInlineError("Token is required.");
      return false;
    }
    const hex64Regex = /^[0-9a-fA-F]{64}$/;
    if (!hex64Regex.test(trimmed)) {
      setTokenInlineError("Invalid token format. Token must be a 64-character hexadecimal string.");
      return false;
    }
    setTokenInlineError("");
    return true;
  };

  const handleTokenBlur = () => {
    if (token) {
      validateTokenFormat(token);
    }
  };

  const isOptionSelected = Boolean(selectedOptionId);
  const isTokenValid = Boolean(token.trim()) && !tokenInlineError;
  const isSubmitDisabled = !isOptionSelected || !isTokenValid || loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateTokenFormat(token) || !selectedOptionId || !ballotId) {
      return;
    }

    setLoading(true);
    setErrorCode(null);

    try {
      const res = await submitVote({
        ballot_id: ballotId,
        ballotId,
        token: token.trim(),
        voterToken: token.trim(),
        option_id: selectedOptionId,
        optionId: selectedOptionId,
      });

      const data = res.data;
      setSubmissionResult({
        stellar_tx_id: data.stellar_tx_id,
        anchor_status: data.anchor_status || "PENDING",
        explorer_url: data.explorer_url,
      });
    } catch (err: any) {
      const status = err.response?.status;
      const respError = err.response?.data?.error;

      if (status === 401 || respError === "INVALID_TOKEN") {
        setErrorCode("INVALID_TOKEN");
      } else if (status === 409 || respError === "TOKEN_ALREADY_USED") {
        setErrorCode("TOKEN_ALREADY_USED");
      } else if (status === 403 || respError === "BALLOT_CLOSED") {
        setErrorCode("BALLOT_CLOSED");
      } else {
        setErrorCode("NETWORK_ERROR");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setError("");
    setIsNetworkError(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Navbar />
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "var(--space-10) 0",
          width: "100%",
        }}
      >
        {/* ── Success screen ─────────────────────────────────────────────── */}
        {success ? (
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
              <CheckIcon
                width="32"
                height="32"
                style={{ color: "var(--semantic-success, #16a34a)" }}
              />
            </div>

            <div>
              <h2
                className="font-space-grotesk font-bold"
                style={{
                  fontSize: "var(--text-2xl)",
                  color: "var(--semantic-success, #16a34a)",
                  marginBottom: "var(--space-2)",
                }}
              >
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
              <div
                className="card"
                style={{
                  padding: "var(--space-4)",
                  background: "var(--semantic-success-bg, #f0fdf4)",
                  border: "1px solid var(--semantic-success-border, #bbf7d0)",
                }}
              >
                <p
                  style={{
                    color: "var(--ink-muted)",
                    fontSize: "var(--text-xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: "var(--space-1)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Vote ID (for your records)
                </p>
                <p
                  className="font-mono"
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-primary)",
                    wordBreak: "break-all",
                  }}
                >
                  {voteId}
                </p>
                <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
                  Use this ID to verify your vote was recorded without revealing your identity.
                </p>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <Link
                to={`/results/${ballotId}`}
                className="btn-primary"
                style={{ textAlign: "center" }}
                aria-label="View results now"
              >
                View Results
              </Link>
              <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}>
                Redirecting to results in {countdown} second{countdown !== 1 ? "s" : ""}…
              </p>
            </div>
          </div>

        /* ── Ballot unavailable ─────────────────────────────────────────── */
        ) : ballotError ? (
          <div className="card p-8 text-center space-y-4">
            <p style={{ color: "var(--ink-secondary)" }}>{ballotError}</p>
            <Link
              to={`/vote/${ballotId}/token`}
              style={{ color: "var(--brand-primary)", fontSize: "var(--text-sm)" }}
            >
              ← Back to Ballot
            </Link>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        {submissionResult ? (
          <VoteConfirmation
            stellar_tx_id={submissionResult.stellar_tx_id}
            anchor_status={submissionResult.anchor_status}
            explorer_url={submissionResult.explorer_url}
            ballotId={ballotId}
          />
        ) : errorCode ? (
          <VoteError
            errorCode={errorCode}
            ballotId={ballotId}
            onRetry={() => setErrorCode(null)}
          />
        ) : fetchError ? (
          <div className="card p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
            <p className="text-red-600 dark:text-red-400 font-medium">{fetchError}</p>
          </div>

        /* ── Loading skeleton ──────────────────────────────────────────── */
        ) : !ballot ? (
          <div className="card p-8 animate-pulse" style={{ height: "320px" }} />

        /* ── Vote form ─────────────────────────────────────────────────── */
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div>
              <div className="section-eyebrow mb-2">Cast Your Vote</div>
              <h1 className="text-3xl font-space-grotesk font-bold mb-2">
                Cast Your Vote
              </h1>
              <p style={{ color: "var(--ink-secondary)" }}>
                Your vote is anonymous and encrypted end-to-end.
              </p>
            </div>

            {/* Ballot info */}
            <div className="card p-4">
              <p
                style={{
                  color: "var(--ink-muted)",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "var(--space-1)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Ballot
              </p>
              <p
                className="font-space-grotesk font-semibold"
                style={{ color: "var(--ink-primary)" }}
              >
                {ballot.topic}
              </p>
              <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>
                Closes: {new Date(ballot.deadline).toLocaleString()}
              </p>
            </div>

            {/* Error banner */}
            {error && (
              <div
                className="message message-error"
                role="alert"
                aria-live="assertive"
                data-testid="error-banner"
              >
                <span className="message-icon" aria-hidden="true">
                  <InfoCircledIcon width="16" height="16" />
                </span>
                <span style={{ flex: 1 }}>{error}</span>
                {isNetworkError && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="btn-ghost"
                    aria-label="Retry submission"
                    data-testid="retry-button"
                    style={{
                      marginLeft: "var(--space-3)",
                      padding: "var(--space-1) var(--space-3)",
                      fontSize: "var(--text-sm)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      minHeight: "unset",
                    }}
                  >
                    <ReloadIcon width="14" height="14" />
                    Retry
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {/* Token input */}
              <div>
                <label
                  htmlFor="voter-token"
                  className="block text-sm font-medium mb-1"
                  style={{ color: "var(--ink-secondary)" }}
                >
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
                    onChange={(e) => { setToken(e.target.value); setError(""); setIsNetworkError(false); }}
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
                  <p
                    id="token-format-error"
                    role="alert"
                    style={{
                      color: "var(--semantic-error)",
                      fontSize: "var(--text-xs)",
                      marginTop: "var(--space-1)",
                    }}
                    data-testid="token-format-error"
                  >
                    Token must be at least 32 hexadecimal characters.
          <div className="card p-8 animate-pulse h-64 bg-white dark:bg-gray-900 rounded-2xl" />
        ) : (
          <div className="space-y-8">
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
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {ballot.topic}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Token Field */}
              <div className="space-y-2">
                <label
                  htmlFor="voter-token-input"
                  className="block text-sm font-semibold text-gray-800 dark:text-gray-200"
                >
                  Eligibility Token
                </label>
                <input
                  id="voter-token-input"
                  type="text"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (tokenInlineError) setTokenInlineError("");
                  }}
                  onBlur={handleTokenBlur}
                  placeholder="Paste your token here"
                  className={`w-full px-4 py-3 font-mono text-sm rounded-xl border bg-white dark:bg-gray-900 transition-colors focus:ring-2 focus:ring-indigo-500 focus:outline-none ${
                    tokenInlineError
                      ? "border-red-500 text-red-900 dark:text-red-200"
                      : "border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                  }`}
                  aria-invalid={Boolean(tokenInlineError)}
                />
                {tokenInlineError && (
                  <p
                    className="text-xs font-medium text-red-600 dark:text-red-400 pt-1"
                    data-testid="token-inline-error"
                  >
                    {tokenInlineError}
                  </p>
                )}
              </div>

              {/* Option selection */}
              <div>
                <label
                  className="block text-sm font-medium mb-3"
                  style={{ color: "var(--ink-secondary)" }}
                  id="option-label"
                >
                  {ballot.allowRankedChoice ? "Rank Your Options" : "Select an Option"}
                  <span aria-hidden="true" style={{ color: "var(--semantic-error)" }}> *</span>
                </label>

                {ballot.allowRankedChoice ? (
                  <div
                    className="space-y-2"
                    role="group"
                    aria-labelledby="option-label"
                    data-testid="ranked-options"
                  >
                    {ballot.options.map((option) => {
                      const rank = rankedOptions.indexOf(option.id) + 1;
                      const isSelected = rankedOptions.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleRankedOption(option.id)}
                          aria-pressed={isSelected}
                          aria-label={`${option.text}${rank > 0 ? `, ranked ${rank}` : ""}`}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "var(--space-3) var(--space-4)",
                            borderRadius: "var(--radius-md)",
                            border: `2px solid ${isSelected ? "var(--brand-primary)" : "var(--border-medium)"}`,
                            background: isSelected ? "var(--brand-primary-pale)" : "var(--surface-sunken)",
                            cursor: "pointer",
                            transition: "border-color var(--transition-fast), background var(--transition-fast)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--ink-primary)", fontWeight: "var(--weight-medium)" }}>
                              {option.text}
                            </span>
                            {rank > 0 && (
                              <span
                                style={{
                                  fontSize: "var(--text-sm)",
                                  fontWeight: "var(--weight-bold)",
                                  color: "var(--brand-primary)",
                                }}
                              >
                                #{rank}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {rankedOptions.length > 0 && (
                      <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                        Ranked {rankedOptions.length} of{" "}
                        {ballot.maxRankings || ballot.options.length} option
                        {ballot.maxRankings !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                ) : (
                  <OptionSelector
                    options={ballot.options}
                    selected={selectedOption}
                    onChange={(id) => { setSelectedOption(id); setError(""); setIsNetworkError(false); }}
                  />
                )}
              </div>

              {/* Confirmation checkbox */}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  cursor: "pointer",
                  padding: "var(--space-4)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${confirmed ? "var(--brand-primary)" : "var(--border-soft)"}`,
                  background: confirmed ? "var(--brand-primary-pale)" : "var(--surface-sunken)",
                  transition: "border-color var(--transition-fast), background var(--transition-fast)",
                }}
                data-testid="confirm-label"
              >
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  aria-label="I understand my vote is final and cannot be changed"
                  data-testid="confirm-checkbox"
                  style={{
                    marginTop: "2px",
                    width: "16px",
                    height: "16px",
                    accentColor: "var(--brand-primary)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--ink-primary)" }}>
                    I understand my vote is final.
                  </span>{" "}
                  Once submitted, votes cannot be changed or retracted. My token will be marked as used.
                </span>
              </label>

              {/* Submit button */}
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
              {/* Option Selector Cards */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Select Ballot Option
                </label>
                <div className="grid gap-3">
                  {ballot.options.map((opt: Option) => {
                    const isSelected = selectedOptionId === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => setSelectedOptionId(opt.id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? "border-indigo-600 dark:border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 ring-2 ring-indigo-500"
                            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-400 dark:hover:border-gray-700"
                        }`}
                        role="button"
                        aria-pressed={isSelected}
                      >
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {opt.text}
                        </span>
                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                            isSelected
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-gray-300 dark:border-gray-700"
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
                              <circle cx="6" cy="6" r="3" />
                            </svg>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className={`w-full py-3.5 px-6 font-semibold rounded-xl text-white shadow-md transition-all ${
                  isSubmitDisabled
                    ? "bg-gray-400 dark:bg-gray-700 cursor-not-allowed opacity-60"
                    : "bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99]"
                }`}
              >
                {loading ? "Submitting Vote..." : "Submit Confidential Vote"}
              </button>

              {/* Back link */}
              <div style={{ textAlign: "center" }}>
                <Link
                  to={`/vote/${ballotId}/token`}
                  style={{
                    color: "var(--ink-muted)",
                    fontSize: "var(--text-sm)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    textDecoration: "none",
                  }}
                  aria-label="Go back to ballot"
                  data-testid="back-link"
                >
                  <ChevronLeftIcon width="14" height="14" />
                  Back to Ballot
                </Link>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
