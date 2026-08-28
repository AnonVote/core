/**
 * Ballot integrity verification (Issue #86).
 *
 * Replaces the previous implementation, whose `handleVerify` was a `setTimeout`
 * that reported success unconditionally without checking anything.
 *
 * This one performs a real check: it recomputes the ballot's commitment from
 * the content being displayed and compares it to the anchored value, reporting
 * exactly what was compared and against which source.
 */
import { useCallback, useState } from "react";
import { getBallotCommitment } from "../api/client";
import CommitmentBadge from "./CommitmentBadge";
import type { BallotCommitment } from "../types";

interface VerificationWidgetProps {
  ballotId: string;
  stellarTxHash?: string;
}

export const VerificationWidget = ({
  ballotId,
  stellarTxHash,
}: VerificationWidgetProps) => {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<BallotCommitment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await getBallotCommitment(ballotId);
      setResult(res.data.data);
    } catch {
      // Report the failure rather than fabricating a pass.
      setError("Verification could not be completed. Please try again.");
      setResult(null);
    } finally {
      setVerifying(false);
    }
  }, [ballotId]);

  return (
    <div
      className="card p-6"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <div>
        <h3
          className="font-semibold"
          style={{ fontSize: "var(--text-lg)", color: "var(--ink-primary)" }}
        >
          Verify ballot integrity
        </h3>
        <p
          style={{ color: "var(--ink-muted)", fontSize: "var(--text-sm)" }}
        >
          Recomputes this ballot&rsquo;s commitment from its current contents and
          compares it to the value anchored when voting opened.
        </p>
      </div>

      {stellarTxHash && (
        <div style={{ fontSize: "var(--text-sm)" }}>
          <code
            style={{
              background: "var(--surface-muted, #f3f4f6)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            Tx: {stellarTxHash}
          </code>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${stellarTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: "var(--space-3)" }}
          >
            View on Stellar Explorer ↗
          </a>
        </div>
      )}

      <button
        onClick={handleVerify}
        disabled={verifying}
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
      >
        {verifying ? "Verifying…" : "Verify ballot integrity"}
      </button>

      {error && (
        <p role="alert" style={{ color: "var(--danger-fg, #7f1d1d)" }}>
          {error}
        </p>
      )}

      {result && <CommitmentBadge ballotId={ballotId} commitment={result} />}
    </div>
  );
};

export default VerificationWidget;
