import React, { useState } from "react";

export interface VoteConfirmationProps {
  stellar_tx_id?: string | null;
  anchor_status?: "ANCHORED" | "PENDING" | "FAILED" | string;
  explorer_url?: string | null;
  ballotId?: string;
}

export const VoteConfirmation: React.FC<VoteConfirmationProps> = ({
  stellar_tx_id,
  anchor_status = "PENDING",
  explorer_url,
  ballotId,
}) => {
  const [copied, setCopied] = useState(false);

  const isAnchored = anchor_status === "ANCHORED" && Boolean(stellar_tx_id);
  const txHash = stellar_tx_id || "";
  const finalExplorerUrl =
    explorer_url ||
    (txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : "");

  const handleCopy = () => {
    if (!txHash) return;
    navigator.clipboard.writeText(txHash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="card p-8 text-center space-y-6 max-w-lg mx-auto shadow-xl border border-gray-200 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-900"
      data-testid="vote-confirmation"
    >
      <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          Vote Recorded
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Your vote has been securely encrypted and submitted.
        </p>
      </div>

      {isAnchored ? (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
              Stellar Transaction ID
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-100">
              ANCHORED
            </span>
          </div>

          <div className="flex items-center gap-2 bg-white dark:bg-gray-900 p-2.5 rounded-lg border border-emerald-300 dark:border-emerald-700 font-mono text-xs text-gray-900 dark:text-gray-100 break-all">
            <span className="flex-1 select-all">{txHash}</span>
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded font-sans transition-colors shrink-0"
              type="button"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {finalExplorerUrl && (
            <a
              href={finalExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium hover:underline pt-1"
            >
              View on Stellar Expert
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      ) : (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800/50 text-left space-y-2">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-sm">
            <svg
              className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Your vote was recorded. Stellar anchoring is in progress.</span>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            The transaction ID will be available shortly once network consensus confirms the anchor block.
          </p>
        </div>
      )}

      {ballotId && (
        <a
          href={`/results/${ballotId}`}
          className="block w-full py-3 px-4 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold rounded-xl hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors shadow"
        >
          View Ballot Results
        </a>
      )}
    </div>
  );
};

export default VoteConfirmation;
