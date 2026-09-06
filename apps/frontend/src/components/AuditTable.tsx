import type { AuditEvent } from "../types";
import { ExclamationTriangleIcon, CheckIcon } from "@radix-ui/react-icons";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Stats Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-4)",
        }}
      >
        <div className="card p-4" style={{ textAlign: "center" }}>
          <p
            style={{
              color: "var(--ink-secondary)",
              fontSize: "var(--text-xs)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-wide)",
              fontFamily: "var(--font-mono)",
              marginBottom: "var(--space-1)",
            }}
          >
            Tokens Issued
          </p>
          <p
            style={{
              color: "var(--ink-primary)",
              fontSize: "var(--text-2xl)",
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-bold)",
            }}
          >
            {tokensIssued}
          </p>
        </div>
        <div className="card p-4" style={{ textAlign: "center" }}>
          <p
            style={{
              color: "var(--ink-secondary)",
              fontSize: "var(--text-xs)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-wide)",
              fontFamily: "var(--font-mono)",
              marginBottom: "var(--space-1)",
            }}
          >
            Votes Cast
          </p>
          <p
            style={{
              color: "var(--ink-primary)",
              fontSize: "var(--text-2xl)",
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-bold)",
            }}
          >
            {votesCast}
          </p>
        </div>
      </div>

      {/* Inconsistency Warning */}
      {!isConsistent && (
        <div className="message message-warning">
          <span className="message-icon">
            <ExclamationTriangleIcon width="16" height="16" />
          </span>
          <span>
            Inconsistency detected: tokens issued ({tokensIssued}) does not
            equal votes cast ({votesCast}).
          </span>
        </div>
      )}

      {/* Consistent Success */}
      {isConsistent && (
        <div className="message message-success">
          <span className="message-icon">
            <CheckIcon width="16" height="16" />
          </span>
          <span>Audit consistent: all issued tokens accounted for.</span>
        </div>
      )}

      {/* Events Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            fontSize: "var(--text-sm)",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-soft)" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-4) var(--space-2) 0",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-body)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-wide)",
                }}
              >
                Event
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-4) var(--space-2) 0",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-body)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-wide)",
                }}
              >
                Time
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-4) var(--space-2) 0",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-body)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-wide)",
                }}
              >
                Ledger Time
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "var(--space-2) 0",
                  color: "var(--ink-primary)",
                  fontFamily: "var(--font-body)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-wide)",
                }}
              >
                Stellar TX
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => {
              const txHref = explorerBase + "/" + ev.stellarTxId;
              const txShort = ev.stellarTxId
                ? ev.stellarTxId.slice(0, 12) + "..."
                : "";
              return (
                <tr
                  key={i}
                  style={{ borderBottom: "1px solid var(--border-soft)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "var(--surface-sunken)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-4) var(--space-3) 0",
                      color: "var(--ink-primary)",
                      fontFamily: "var(--font-body)",
                    }}
                  >
                    {ev.eventType.replace(/_/g, " ")}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-4) var(--space-3) 0",
                      color: "var(--ink-muted)",
                      fontSize: "var(--text-xs)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {new Date(ev.createdAt).toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-3) var(--space-4) var(--space-3) 0",
                      fontSize: "var(--text-xs)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {ev.stellarLedgerAt ? (
                      <span style={{ color: "var(--semantic-success)" }}>
                        {new Date(ev.stellarLedgerAt).toLocaleString()}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "var(--space-3) 0" }}>
                    {ev.stellarTxId ? (
                      <a
                        href={txHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          fontSize: "var(--text-xs)",
                          maxWidth: "120px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--brand-primary)",
                          textDecoration: "none",
                          fontFamily: "var(--font-mono)",
                          background: "var(--surface-sunken)",
                          border: "1px solid var(--border-soft)",
                          borderRadius: "var(--radius-sm)",
                          padding: "2px 8px",
                        }}
                      >
                        {txShort}
                      </a>
                    ) : (
                      <span
                        style={{
                          color: "var(--ink-muted)",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
