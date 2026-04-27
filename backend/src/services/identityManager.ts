import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import { writeRecord } from "./stellarService";
import { badRequest, notFound } from "../utils/errors";

/**
 * Issue a one-time anonymous voter token.
 * Privacy guarantee: no link is stored between the voter identifier and the token.
 */
export async function issueToken(
  ballotId: string,
  voterIdentifier: string,
): Promise<string> {
  // Get ballot with eligibility list
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId },
    include: { eligibilityList: true },
  });

  // Don't reveal whether ballot exists if identifier not eligible
  const identifierHash = hashIdentifier(voterIdentifier);

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

  if (!entry) {
    // Generic error — don't reveal whether identifier was not found
    throw badRequest(
      "Unable to issue token. Please check your ballot link and identifier.",
    );
  }

  if (entry.tokenIssued) {
    // Record duplicate attempt in audit log (no identifier stored)
    await prisma.auditEvent.create({
      data: { ballotId, eventType: "DUPLICATE_TOKEN_ATTEMPT" },
    });
    throw badRequest(
      "A token has already been issued for this identifier on this ballot.",
    );
  }

  // Generate raw token — only hash is stored
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  await prisma.$transaction(async (tx) => {
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

    // Write to Stellar async (non-blocking)
    writeRecord({ type: "TOKEN_ISSUED", ballotId, auditEventId: auditEvent.id })
      .then((txId) => {
        if (txId) {
          prisma.auditEvent
            .update({
              where: { id: auditEvent.id },
              data: { stellarTxId: txId },
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  });

  return rawToken;
}
