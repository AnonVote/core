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
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Get Your Voting Token</h1>
        <p className="text-gray-400 mb-8">
          Enter your identifier to receive a one-time anonymous voting token.
        </p>

        {ballotError ? (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 text-center">
            <p className="text-gray-400">{ballotError}</p>
          </div>
        ) : !ballot ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 animate-pulse h-48" />
        ) : token ? (
          <TokenDisplay token={token} ballotId={ballotId!} />
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
                Ballot
              </p>
              <p className="text-white font-semibold">{ballot.topic}</p>
              <p className="text-gray-400 text-sm mt-1">
                Closes: {new Date(ballot.deadline).toLocaleString()}
              </p>
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Your Voter Identifier
                </label>
                <p className="text-gray-500 text-xs mb-2">
                  e.g. your email address or employee ID as provided by your
                  administrator
                </p>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="your.email@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition"
              >
                {loading ? "Requesting token..." : "Get My Token"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
