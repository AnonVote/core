import { Link } from "react-router-dom";
import type { Ballot } from "../types";

interface Props {
  ballot: Ballot;
}

export default function BallotCard({ ballot }: Props) {
  const isOpen = ballot.status === "OPEN";
  const deadline = new Date(ballot.deadline);
  const tokenLink = `${window.location.origin}/vote/${ballot.id}/token`;

  const copyLink = () => navigator.clipboard.writeText(tokenLink);

  return (
    <div className="card p-6 hover:border-gray-600 dark:hover:border-gray-500 transition">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h3 className="text-gray-900 dark:text-white font-semibold text-lg leading-snug">
          {ballot.topic}
        </h3>
        <span
          className={`shrink-0 text-xs font-space-grotesk font-semibold px-2.5 py-1 rounded-full ${isOpen ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"}`}
        >
          {isOpen ? "OPEN" : "CLOSED"}
        </span>
      </div>

      {ballot.result && !ballot.result.isConsistent && (
        <div className="bg-yellow-100 dark:bg-yellow-900/30 border-l-4 border-yellow-500 rounded-lg px-3 py-2 text-xs mb-4">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-yellow-600 dark:text-yellow-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-yellow-800 dark:text-yellow-200">
              Inconsistency detected: vote count does not match issued tokens.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">
            Eligible
          </p>
          <p className="text-gray-900 dark:text-white font-semibold">
            {ballot.eligibleVoters ?? "—"}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">
            Votes Cast
          </p>
          <p className="text-gray-900 dark:text-white font-semibold">
            {ballot.votesCast ?? "—"}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-xs mb-1">
            Deadline
          </p>
          <p className="text-gray-900 dark:text-white font-semibold text-xs">
            {deadline.toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <button
            onClick={copyLink}
            className="flex-1 min-w-0 bg-[#2cb67d] hover:bg-[#198259] text-white text-sm px-3 py-2 rounded-lg transition truncate"
          >
            Copy Voter Link
          </button>
        )}
        {!isOpen && ballot.result && (
          <Link
            to={`/results/${ballot.id}`}
            className="flex-1 min-w-0 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-sm px-3 py-2 rounded-lg transition text-center"
          >
            View Results
          </Link>
        )}
        <Link
          to={`/audit/${ballot.id}`}
          className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm px-3 py-2 rounded-lg transition"
        >
          Audit
        </Link>
      </div>
    </div>
  );
}
