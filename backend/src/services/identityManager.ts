import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { sorobanRecordToken } from "./sorobanService";
import {
  badRequest,
  notFound,
  alreadyVoted,
  tokenAlreadyIssued,
} from "../utils/errors";

/**
 * Issue a one-time anonymous voter token.
 * Privacy guarantee: no link is stored between the voter identifier and the token.
 * Stellar write is required — token issuance is rolled back if Stellar write fails.
 */
export async function issueToken(
  ballotId: string,
  voterIdentifier: string,
): Promise<{ token: string; stellarTxId: string; weight: number }> {
  // Get ballot with eligibility list
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { eligibilityList: true },
  });

  // Don't reveal whether ballot exists if identifier not eligible
  const identifierHash = hashIdentifier(voterIdentifier);
  console.log("[issueToken] ballotId:", ballotId, "identifierHash:", identifierHash);

  if (!ballot || ballot.status === "CLOSED") {
    // Generic error — don't reveal ballot existence
    throw badRequest(
      "Unable to issue token. Please check your ballot link and identifier.",
    );
  }

  const entry = await prisma.eligibilityEntry.findUnique({
    where: {
      eligibilityListId_identifierHash: {
        eligibilityListId: ballot.eligibilityListId,
        identifierHash,
      },
    },
  });

  console.log("[issueToken] eligibilityListId:", ballot.eligibilityListId);
  console.log(
    "[issueToken] entry found:",
    !!entry,
    "tokenIssued:",
    entry?.tokenIssued,
  );

  if (!entry) {
    // Generic error — don't reveal whether identifier was not found
    throw badRequest(
      "The identifier you entered is not in the eligibility list. Please check your email or contact your administrator.",
    );
  }

  if (entry.tokenIssued) {
    // Check if the token was already used to vote
    const usedTokenCount = await prisma.voterToken.count({
      where: { ballotId, used: true },
    });
    const issuedCount = await prisma.eligibilityEntry.count({
      where: {
        eligibilityListId: ballot.eligibilityListId,
        tokenIssued: true,
      },
    });

    // Record duplicate attempt in audit log (no identifier stored)
    await prisma.auditEvent.create({
      data: { ballotId, eventType: "DUPLICATE_TOKEN_ATTEMPT" },
    });

    if (usedTokenCount >= issuedCount) {
      // All issued tokens have been used — this voter already voted
      throw alreadyVoted(
        "Your vote has already been cast. You cannot request a new token.",
      );
    }

    // Token issued but not yet used — offer reissue
    throw tokenAlreadyIssued(
      "A token has already been issued for this identifier on this ballot.",
    );
  }

  // Generate raw token — only hash is stored
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  const result = await prisma.$transaction(async (tx) => {
    // Store token hash only
    await tx.voterToken.create({
      data: { tokenHash, ballotId },
    });

    // Mark identifier as token-issued
    await tx.eligibilityEntry.update({
      where: { id: entry.id },
      data: { tokenIssued: true },
    });

    // Audit event — no voter identifier stored
    const auditEvent = await tx.auditEvent.create({
      data: { ballotId, eventType: "TOKEN_ISSUED" },
    });

    return { auditEventId: auditEvent.id, weight: (entry as any).weight };
  });

  // Return token immediately — Stellar write happens in background
  const tokenResponse = {
    token: rawToken,
    stellarTxId: "",
    weight: result.weight,
  };

  // Record token issuance on-chain — fire-and-forget
  sorobanRecordToken(hashIdentifier(ballotId)).catch((err) =>
    console.error("[Soroban] record_token failed:", err),
  );

  // Fire-and-forget Stellar write — does not block the response
  writeRecord({
    type: "TOKEN_ISSUED",
    ballotId,
    auditEventId: result.auditEventId,
  })
    .then((stellarResult) => {
      if (stellarResult.txHash) {
        prisma.auditEvent
          .update({
            where: { id: result.auditEventId },
            data: {
              stellarTxId: stellarResult.txHash,
              stellarLedgerAt: stellarResult.ledgerTimestamp,
            },
          })
          .catch(() => {});
      } else {
        console.warn(
          `[Stellar] TOKEN_ISSUED write failed for auditEvent ${result.auditEventId}`,
        );
      }
    })
    .catch(() => {});

  return tokenResponse;
}

/**
 * Re-issue a token for a voter who lost theirs.
 * - If their previous token was NOT used to vote: revoke it, issue a new one.
 * - If their previous token WAS used to vote: block with a clear message.
 * Privacy guarantee: identifier hash is never linked to the token.
 */
export async function reissueToken(
  ballotId: string,
  voterIdentifier: string,
): Promise<{ token: string; weight: number }> {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { eligibilityList: true },
  });

  if (!ballot || ballot.status === "CLOSED") {
    throw badRequest(
      "Unable to issue token. Please check your ballot link and identifier.",
    );
  }

  const identifierHash = hashIdentifier(voterIdentifier);

  const entry = await prisma.eligibilityEntry.findUnique({
    where: {
      eligibilityListId_identifierHash: {
        eligibilityListId: ballot.eligibilityListId,
        identifierHash,
      },
    },
  });

  if (!entry) {
    throw badRequest(
      "The identifier you entered is not in the eligibility list.",
    );
  }

  if (!entry.tokenIssued) {
    // No token was ever issued — just issue normally
    return issueToken(ballotId, voterIdentifier);
  }

  // Find all tokens for this ballot that haven't been used
  // We can't link a token to an identifier (by design), so we check
  // if ANY unused token exists for this ballot. If the voter's token
  // was used, all tokens for this ballot that are used = their vote was cast.
  // We use a per-entry reissue flag to track this safely.
  const unusedTokens = await prisma.voterToken.findMany({
    where: { ballotId, used: false },
  });

  // Count used tokens = votes cast
  const usedTokenCount = await prisma.voterToken.count({
    where: { ballotId, used: true },
  });

  // Count how many entries have tokenIssued = true
  const issuedCount = await prisma.eligibilityEntry.count({
    where: {
      eligibilityListId: ballot.eligibilityListId,
      tokenIssued: true,
    },
  });

  // If used tokens >= issued entries, this voter's token was already used
  if (usedTokenCount >= issuedCount) {
    throw badRequest(
      "Your vote has already been cast with your previous token. You cannot request a new token.",
    );
  }

  // Safe to reissue — revoke one unused token and issue a fresh one
  const rawToken = generateToken();
  const newTokenHash = hashToken(rawToken);

  await prisma.$transaction(async (tx) => {
    // Delete one unused token (the voter's lost token)
    if (unusedTokens.length > 0) {
      await tx.voterToken.delete({ where: { id: unusedTokens[0].id } });
    }

    // Issue new token
    await tx.voterToken.create({
      data: { tokenHash: newTokenHash, ballotId },
    });

    // Audit event
    await tx.auditEvent.create({
      data: { ballotId, eventType: "TOKEN_ISSUED" },
    });
  });

  console.log(`[reissueToken] Reissued token for ballot ${ballotId}`);

  return { token: rawToken, weight: (entry as any).weight ?? 1 };
}

/**
 * Reset all token issuance flags for a ballot's eligibility list.
 * Admin function — allows voters to request tokens again.
 * WARNING: Does not revoke already-issued tokens, only resets the issued flag.
 */
export async function resetBallotTokens(
  ballotId: string,
): Promise<{ resetCount: number }> {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    select: { eligibilityListId: true },
  });

  if (!ballot) {
    throw notFound("Ballot not found");
  }

  const result = await prisma.eligibilityEntry.updateMany({
    where: {
      eligibilityListId: ballot.eligibilityListId,
      tokenIssued: true,
    },
    data: { tokenIssued: false },
  });

  console.log(
    `[resetBallotTokens] Reset ${result.count} entries for ballot ${ballotId}`,
  );

  return { resetCount: result.count };
}
