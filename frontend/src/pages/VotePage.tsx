import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getBallot, submitVote } from "../api/client";
import Navbar from "../components/Navbar";
import OptionSelector from "../components/OptionSelector";
import type { Ballot } from "../types";

export default function VotePage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  const [token, setToken] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!ballotId) return;
    getBallot(ballotId)
      .then((res) => {
        const b = res.data.data;
        if (b.status !== "OPEN")
          setBallotError("This ballot is not currently accepting votes.");
        else setBallot(b);
      })
      .catch(() => setBallotError("This ballot is not available."));
  }, [ballotId]);

  const canSubmit = token.trim().length > 0 && selectedOption !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      await submitVote({
        ballotId: ballotId!,
        voterToken: token.trim(),
        optionId: selectedOption,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          "Failed to submit vote. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-grid-overlay glow-indigo glow-emerald">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
        {success ? (
          <div className="card p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-space-grotesk font-bold text-green-600 dark:text-green-400">
              Vote Submitted
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Your anonymous vote has been recorded on the Stellar blockchain.
            </p>
            <Link to={`/results/${ballotId}`} className="block btn-primary">
              View Results
            </Link>
          </div>
        ) : ballotError ? (
          <div className="card p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400">{ballotError}</p>
          </div>
        ) : !ballot ? (
          <div className="card p-8 animate-pulse h-64" />
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-space-grotesk font-bold mb-2">
                Cast Your Vote
              </h1>
              <p className="text-gray-600 dark:text-gray-300">
                Your vote is anonymous and encrypted.
              </p>
            </div>

            <div className="card p-4">
              <p className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1 font-mono">
                Ballot
              </p>
              <p className="text-gray-900 dark:text-white font-semibold">
                {ballot.topic}
              </p>
            </div>

            {error && (
              <div className="error-message">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Your Voting Token
                </label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                      />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="input-field has-icon font-mono text-sm"
                    placeholder="Paste your token here"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Select an Option
                </label>
                <OptionSelector
                  options={ballot.options}
                  selected={selectedOption}
                  onChange={setSelectedOption}
                />
              </div>

              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="w-full btn-primary"
              >
                {loading ? (
                  <span className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                ) : (
                  "Cast Vote — This cannot be undone"
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
