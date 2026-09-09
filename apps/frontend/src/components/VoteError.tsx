import React from "react";

export type VoteErrorCode =
  | "INVALID_TOKEN"
  | "TOKEN_ALREADY_USED"
  | "BALLOT_CLOSED"
  | "NETWORK_ERROR"
  | string;

export interface VoteErrorProps {
  errorCode: VoteErrorCode;
  onRetry?: () => void;
  ballotId?: string;
}

export const VoteError: React.FC<VoteErrorProps> = ({
  errorCode,
  onRetry,
  ballotId,
}) => {
  const getErrorInfo = () => {
    switch (errorCode) {
      case "INVALID_TOKEN":
        return {
          title: "Invalid Token",
          message: "This token is not recognised for this ballot.",
          actionText: "Request a New Token",
          actionUrl: ballotId ? `/tokens?ballotId=${ballotId}` : "/tokens",
          isLink: true,
        };
      case "TOKEN_ALREADY_USED":
        return {
          title: "Token Already Used",
          message: "This token has already been used to cast a vote.",
          actionText: "View Ballot Results",
          actionUrl: ballotId ? `/results/${ballotId}` : "/results",
          isLink: true,
        };
      case "BALLOT_CLOSED":
        return {
          title: "Ballot Closed",
          message: "This ballot has closed and is no longer accepting votes.",
          actionText: "View Final Results",
          actionUrl: ballotId ? `/results/${ballotId}` : "/results",
          isLink: true,
        };
      case "NETWORK_ERROR":
      default:
        return {
          title: "Submission Error",
          message: "Something went wrong. Your vote was not submitted. Please try again.",
          actionText: "Try Again",
          actionUrl: "",
          isLink: false,
        };
    }
  };

  const info = getErrorInfo();

  return (
    <div
      className="card p-6 text-center space-y-5 max-w-md mx-auto border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 rounded-2xl shadow-lg"
      data-testid="vote-error"
    >
      <div className="w-14 h-14 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mx-auto text-red-600 dark:text-red-400">
        <svg
          className="w-7 h-7"
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
      </div>

      <div className="space-y-1">
        <h3 className="text-xl font-bold text-red-900 dark:text-red-200">
          {info.title}
        </h3>
        <p className="text-sm text-red-700 dark:text-red-300 font-medium">
          {info.message}
        </p>
      </div>

      <div className="pt-2">
        {info.isLink ? (
          <a
            href={info.actionUrl}
            className="inline-block w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
          >
            {info.actionText}
          </a>
        ) : (
          <button
            onClick={onRetry}
            type="button"
            className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
          >
            {info.actionText}
          </button>
        )}
      </div>
    </div>
  );
};

export default VoteError;
