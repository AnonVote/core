import React, { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import VoteConfirmation from "../components/VoteConfirmation";
import VoteError, { VoteErrorCode } from "../components/VoteError";
import { getBallot, submitVote } from "../api/client";
import type { Ballot, Option } from "../types";

export default function VotePage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const location = useLocation();

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

  return (
    <div className="page-wrapper min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Navbar />

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
        ) : !ballot ? (
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
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
