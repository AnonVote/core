/**
 * Renders a ballot's end-to-end encrypted description (Issue #86).
 *
 * Decrypts in place when this session holds the organization key; otherwise
 * shows a placeholder. Renders nothing at all when the ballot has no
 * description, so ballots that predate the feature look exactly as before.
 */
import { useMemo } from "react";
import { decryptDescription } from "../utils/org-crypto";
import { useOrgKey } from "../hooks/useOrgKey";

interface Props {
  descriptionCiphertext?: string | null;
  /** Clamp to a few lines in dense list views. */
  clamp?: boolean;
}

export default function BallotDescription({
  descriptionCiphertext,
  clamp = false,
}: Props) {
  const { orgKey } = useOrgKey();

  const text = useMemo(() => {
    if (!descriptionCiphertext || !orgKey) return null;
    try {
      return decryptDescription(descriptionCiphertext, orgKey);
    } catch {
      // Wrong key, or tampered ciphertext — treat as unreadable.
      return null;
    }
  }, [descriptionCiphertext, orgKey]);

  if (!descriptionCiphertext) return null;

  const base = {
    fontSize: "var(--text-sm)",
    color: "var(--ink-muted)",
    margin: "var(--space-2) 0 0",
  } as const;

  if (!text) {
    return (
      <p style={{ ...base, fontStyle: "italic" }}>
        Encrypted — sign in to view
      </p>
    );
  }

  return (
    <p
      style={
        clamp
          ? {
              ...base,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
          : { ...base, whiteSpace: "pre-wrap" }
      }
    >
      {text}
    </p>
  );
}
