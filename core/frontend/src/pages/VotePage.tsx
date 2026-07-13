import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { getBallot, submitVote } from "../api/client";
import Navbar from "../components/Navbar";
import OptionSelector from "../components/OptionSelector";
import type { Ballot } from "../types";
import {
  CheckIcon,
  InfoCircledIcon,
  KeyboardIcon,
} from "@radix-ui/react-icons";

export default function VotePage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const location = useLocation();
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ballotError, setBallotError] = useState("");
  // Pre-fill token if navigated from token page
  const [token, setToken] = useState<string>(
    (location.state as any)?.token || "",
  );
  const [selectedOption, setSelectedOption] = useState("");
  const [rankedOptions, setRankedOptions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [voteWeight, setVoteWeight] = useState<number>(1);
  const [verificationHash, setVerificationHash] = useState("");

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

  // Handle ranked-choice selection
  const toggleRankedOption = (optionId: string) => {
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

  const canSubmit =
    token.trim().length > 0 &&
    (selectedOption !== "" || rankedOptions.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      // For ranked-choice, submit the first choice with all ranks
      const voteData: any = {
        ballotId: ballotId!,
        voterToken: token.trim(),
        optionId: rankedOptions.length > 0 ? rankedOptions[0] : selectedOption,
        weight: voteWeight,
      };

      if (rankedOptions.length > 0) {
        voteData.rank = rankedOptions.indexOf(voteData.optionId) + 1;
        voteData.rankedOptions = rankedOptions;
      }

      const result = await submitVote(voteData);
      setSuccess(true);
      setVerificationHash(`${result.data.data.voteId}:${ballotId}`);
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
        {success ? (
          <div className="card p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckIcon
                className="w-8 h-8 text-green-600 dark:text-green-400"
                width="32"
                height="32"
              />
            </div>
            <h2 className="text-2xl font-space-grotesk font-bold text-green-600 dark:text-green-400">
              Vote Submitted
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Your anonymous vote has been recorded on the Stellar blockchain.
            </p>
            {verificationHash && (
              <div className="card p-4 bg-green-50 dark:bg-green-900/20">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                  Verification Hash
                </p>
                <p className="font-mono text-sm text-gray-900 dark:text-white break-all">
                  {verificationHash}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Use this hash to verify your vote was recorded without
                  exposing your identity
                </p>
              </div>
            )}
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
              <div
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

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Your Voting Token
                </label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <KeyboardIcon />
                  </span>
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="input-field has-icon font-mono text-sm"
                    placeholder="Paste your token here"
                    aria-required="true"
                    aria-label="Voting token"
                    aria-invalid={!!error}
                    onBlur={() => {
                      // Set default weight for now
                      setVoteWeight(1);
                    }}
                  />
                  {voteWeight > 1 && (
                    <span className="input-icon-right">
                      <span className="text-xs font-medium text-[var(--brand-primary)]">
                        Weight: {voteWeight}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {ballot.allowRankedChoice
                    ? "Rank Your Options"
                    : "Select an Option"}
                </label>
                {ballot.allowRankedChoice ? (
                  <div className="space-y-2">
                    {ballot.options.map((option) => {
                      const rank = rankedOptions.indexOf(option.id) + 1;
                      const isSelected = rankedOptions.includes(option.id);
                      return (
                        <div
                          key={option.id}
                          onClick={() => toggleRankedOption(option.id)}
                          className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-[var(--brand-primary-pale)] border-[var(--brand-primary)]"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-[var(--brand-primary)]"
                          } border rounded-lg`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-gray-900 dark:text-white">
                              {option.text}
                            </span>
                            {rank > 0 && (
                              <span className="text-sm font-bold text-[var(--brand-primary)]">
                                #{rank}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {rankedOptions.length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        You've ranked {rankedOptions.length} of{" "}
                        {ballot.maxRankings || ballot.options.length} options
                      </p>
                    )}
                  </div>
                ) : (
                  <OptionSelector
                    options={ballot.options}
                    selected={selectedOption}
                    onChange={setSelectedOption}
                  />
                )}
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
