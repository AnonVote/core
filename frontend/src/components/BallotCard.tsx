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
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h3 className="text-white font-semibold text-lg leading-snug">
          {ballot.topic}
        </h3>
        <span
          className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${isOpen ? "bg-green-900/50 text-green-400 border border-green-800" : "bg-gray-800 text-gray-400 border border-gray-700"}`}
        >
          {isOpen ? "OPEN" : "CLOSED"}
        </span>
      </div>

      {ballot.result && !ballot.result.isConsistent && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-3 py-2 text-xs mb-4">
          ⚠️ Inconsistency detected: vote count does not match issued tokens.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Eligible</p>
          <p className="text-white font-semibold">
            {ballot.eligibleVoters ?? "—"}
          </p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Votes Cast</p>
          <p className="text-white font-semibold">{ballot.votesCast ?? "—"}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3 text-center">
          <p className="text-gray-400 text-xs mb-1">Deadline</p>
          <p className="text-white font-semibold text-xs">
            {deadline.toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <button
            onClick={copyLink}
            className="flex-1 min-w-0 bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-2 rounded-lg transition truncate"
          >
            Copy Voter Link
          </button>
        )}
        {!isOpen && ballot.result && (
          <Link
            to={`/results/${ballot.id}`}
            className="flex-1 min-w-0 bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition text-center"
          >
            View Results
          </Link>
        )}
        <Link
          to={`/audit/${ballot.id}`}
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg transition"
        >
          Audit
        </Link>
      </div>
    </div>
  );
}
