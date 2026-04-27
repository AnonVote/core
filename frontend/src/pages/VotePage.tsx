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
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
        {success ? (
          <div className="bg-gray-900 border border-green-800 rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-900/40 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-green-400"
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
            <h2 className="text-2xl font-bold text-green-400">
              Vote Submitted
            </h2>
            <p className="text-gray-400">
              Your anonymous vote has been recorded on the Stellar blockchain.
            </p>
            <Link
              to={`/results/${ballotId}`}
              className="block bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg font-semibold transition"
            >
              View Results →
            </Link>
          </div>
        ) : ballotError ? (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
            <p className="text-gray-400">{ballotError}</p>
          </div>
        ) : !ballot ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 animate-pulse h-64" />
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Cast Your Vote</h1>
              <p className="text-gray-400">
                Your vote is anonymous and encrypted.
              </p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
                Ballot
              </p>
              <p className="text-white font-semibold">{ballot.topic}</p>
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Your Voting Token
                </label>
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Paste your token here"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
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
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
              >
                {loading ? "Submitting..." : "Submit Vote"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
