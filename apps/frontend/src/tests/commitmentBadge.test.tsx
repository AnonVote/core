/**
 * CommitmentBadge and BallotDescription — Issue #86.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CommitmentBadge from "../components/CommitmentBadge";
import BallotDescription from "../components/BallotDescription";
import * as apiClient from "../api/client";
import {
  deriveOrgKeypair,
  encryptDescription,
  toBase64,
} from "../utils/org-crypto";
import { cacheOrgKey, clearOrgKey } from "../hooks/useOrgKey";

const BALLOT_ID = "3f2e1d0c-1111-4222-8333-444455556666";
const SALT = toBase64(new Uint8Array(16).fill(3));
const PASSWORD = "an admin password";

function commitmentResponse(over: Partial<apiClient.BallotCommitmentShape> = {}) {
  return {
    data: {
      data: {
        ballotId: BALLOT_ID,
        commitmentHash: "a".repeat(64),
        onChain: "a".repeat(64),
        status: "verified",
        source: "chain",
        ...over,
      },
    },
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearOrgKey();
});

describe("CommitmentBadge", () => {
  it("reports a verified ballot and names the chain as its source", async () => {
    vi.spyOn(apiClient, "getBallotCommitment").mockResolvedValue(
      commitmentResponse(),
    );

    render(<CommitmentBadge ballotId={BALLOT_ID} />);

    await waitFor(() =>
      expect(screen.getByText(/content verified/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/stellar\/soroban ledger/i)).toBeInTheDocument();
  });

  it("warns loudly when the content no longer matches", async () => {
    vi.spyOn(apiClient, "getBallotCommitment").mockResolvedValue(
      commitmentResponse({ status: "mismatch", onChain: "b".repeat(64) }),
    );

    render(<CommitmentBadge ballotId={BALLOT_ID} />);

    await waitFor(() =>
      expect(screen.getByText(/content altered/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/do not trust its contents/i)).toBeInTheDocument();
  });

  it("says a DB-copy check is not a ledger check", async () => {
    vi.spyOn(apiClient, "getBallotCommitment").mockResolvedValue(
      commitmentResponse({ source: "database" }),
    );

    render(<CommitmentBadge ballotId={BALLOT_ID} />);

    await waitFor(() =>
      expect(screen.getByText(/content verified/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/not the ledger/i)).toBeInTheDocument();
  });

  it("reports unanchored rather than claiming a pass", async () => {
    vi.spyOn(apiClient, "getBallotCommitment").mockResolvedValue(
      commitmentResponse({ status: "unanchored", onChain: null, source: "none" }),
    );

    render(<CommitmentBadge ballotId={BALLOT_ID} />);

    await waitFor(() =>
      expect(screen.getByText(/not anchored/i)).toBeInTheDocument(),
    );
  });

  it("reports a failed check as a failure, never as verified", async () => {
    vi.spyOn(apiClient, "getBallotCommitment").mockRejectedValue(
      new Error("network down"),
    );

    render(<CommitmentBadge ballotId={BALLOT_ID} />);

    await waitFor(() =>
      expect(
        screen.getByText(/could not be checked/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/content verified/i)).toBeNull();
  });
});

describe("BallotDescription", () => {
  beforeEach(() => clearOrgKey());

  it("renders nothing when the ballot has no description", () => {
    const { container } = render(
      <BallotDescription descriptionCiphertext={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a placeholder when this session has no key", () => {
    const { publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("Board-only context", publicKey);

    render(<BallotDescription descriptionCiphertext={envelope} />);

    expect(screen.getByText(/encrypted — sign in to view/i)).toBeInTheDocument();
    expect(screen.queryByText(/board-only context/i)).toBeNull();
  });

  it("decrypts in place when the key is cached", () => {
    const { privateKey, publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("Board-only context", publicKey);
    cacheOrgKey(privateKey);

    render(<BallotDescription descriptionCiphertext={envelope} />);

    expect(screen.getByText("Board-only context")).toBeInTheDocument();
  });

  it("falls back to the placeholder when the cached key is wrong", () => {
    const { publicKey } = deriveOrgKeypair(PASSWORD, SALT);
    const envelope = encryptDescription("Board-only context", publicKey);
    cacheOrgKey(deriveOrgKeypair("a different password", SALT).privateKey);

    render(<BallotDescription descriptionCiphertext={envelope} />);

    expect(screen.getByText(/encrypted — sign in to view/i)).toBeInTheDocument();
  });
});
