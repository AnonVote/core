import type { AuditEvent } from "../types";

interface Props {
  events: AuditEvent[];
  tokensIssued: number;
  votesCast: number;
  network?: string;
}

const STELLAR_EXPLORER_BASE = "https://stellar.expert/explorer/testnet/tx";

export default function AuditTable({
  events,
  tokensIssued,
  votesCast,
  network = "testnet",
}: Props) {
  const explorerBase =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public/tx"
      : STELLAR_EXPLORER_BASE;

  const isConsistent = tokensIssued === votesCast;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
            Tokens Issued
          </p>
          <p className="text-white text-2xl font-bold">{tokensIssued}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">
            Votes Cast
          </p>
          <p className="text-white text-2xl font-bold">{votesCast}</p>
        </div>
      </div>

      {!isConsistent && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          ⚠️ Inconsistency detected: tokens issued ({tokensIssued}) does not
          equal votes cast ({votesCast}).
        </div>
      )}

      {isConsistent && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 rounded-lg px-4 py-3 text-sm">
          ✓ Audit consistent: all issued tokens accounted for.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-800">
              <th className="text-left py-2 pr-4">Event</th>
              <th className="text-left py-2 pr-4">Time</th>
              <th className="text-left py-2">Stellar TX</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr
                key={i}
                className="border-b border-gray-800/50 hover:bg-gray-900/50"
              >
                <td className="py-2 pr-4 text-gray-300">
                  {ev.eventType.replace(/_/g, " ")}
                </td>
                <td className="py-2 pr-4 text-gray-400 text-xs">
                  {new Date(ev.createdAt).toLocaleString()}
                </td>
                <td className="py-2">
                  {ev.stellarTxId ? (
                    <a
                      href={`${explorerBase}/${ev.stellarTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 font-mono text-xs truncate block max-w-[120px]"
                    >
                      {ev.stellarTxId.slice(0, 12)}...
                    </a>
                  ) : (
                    <span className="text-gray-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
