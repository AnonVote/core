import { useState } from "react";
import { Link } from "react-router-dom";

interface Props {
  token: string;
  ballotId: string;
}

export default function TokenDisplay({ token, ballotId }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-gray-900 border border-indigo-800 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 text-indigo-400">
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
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
        <span className="font-semibold">Your Voting Token</span>
      </div>

      <div className="bg-gray-950 border border-gray-700 rounded-lg p-4">
        <p className="font-mono text-sm text-green-400 break-all select-all">
          {token}
        </p>
      </div>

      <button
        onClick={copy}
        className={`w-full py-2.5 rounded-lg font-semibold text-sm transition ${copied ? "bg-green-700 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
      >
        {copied ? "✓ Copied!" : "Copy Token"}
      </button>

      <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg px-4 py-3 text-yellow-300 text-xs">
        ⚠️ Store this token securely. It cannot be recovered. You will need it
        to cast your vote.
      </div>

      <Link
        to={`/vote/${ballotId}`}
        className="block w-full text-center bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg text-sm font-semibold transition"
      >
        Proceed to Vote →
      </Link>
    </div>
  );
}
