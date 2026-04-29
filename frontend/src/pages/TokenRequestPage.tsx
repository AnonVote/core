import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getBallot, requestToken } from "../api/client";
import Navbar from "../components/Navbar";
import TokenDisplay from "../components/TokenDisplay";
import type { Ballot } from "../types";

export default function TokenRequestPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    } catch {
      setError(
        "Unable to issue token. Please verify your identifier and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-grid-overlay glow-indigo glow-emerald">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
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
        ) : (
          <div className="card p-6 space-y-6">
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
