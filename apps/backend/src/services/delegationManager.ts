import { prisma } from "../prisma/client";
import { badRequest } from "../utils/errors";

/**
 * Delegate voting power from one token to another.
 * The delegator's token becomes "used" but the vote is cast by the delegate.
 */
export async function delegateVote(
  ballotId: string,
  delegatorTokenHash: string,
  delegateTokenHash: string,
): Promise<{ message: string }> {
  // Find the delegator token
  const delegatorToken = await prisma.voterToken.findUnique({
    where: { tokenHash: delegatorTokenHash },
  });

  if (!delegatorToken) {
    throw badRequest("Invalid delegator token.");
  }

  if (delegatorToken.ballotId !== ballotId) {
    throw badRequest("Delegator token does not belong to this ballot.");
  }

  if (delegatorToken.used) {
    throw badRequest("This token has already been used.");
  }

  if (delegatorToken.delegatedTo) {
    throw badRequest("This token has already delegated its vote.");
  }

  // Find the delegate token
  const delegateToken = await prisma.voterToken.findUnique({
    where: { tokenHash: delegateTokenHash },
  });

  if (!delegateToken) {
    throw badRequest("Invalid delegate token.");
  }

  if (delegateToken.ballotId !== ballotId) {
    throw badRequest("Delegate token does not belong to this ballot.");
  }

  if (delegateToken.used) {
    throw badRequest("Delegate token has already been used.");
  }

  // Prevent self-delegation
  if (delegatorToken.id === delegateToken.id) {
    throw badRequest("Cannot delegate to yourself.");
  }

  // Check for circular delegation
  if (delegateToken.delegatedTo === delegatorToken.id) {
    throw badRequest("Circular delegation detected.");
  }

  // Perform the delegation in a transaction
  await prisma.$transaction(async (tx) => {
    // Mark delegator token as used for delegation
    await tx.voterToken.update({
      where: { id: delegatorToken.id },
      data: {
        used: true,
        usedAt: new Date(),
        delegatedTo: delegateToken.id,
      },
    });

    // Set delegate's delegatedFrom field
    await tx.voterToken.update({
      where: { id: delegateToken.id },
      data: { delegatedFrom: delegatorToken.id },
    });
  });

  return { message: "Vote delegated successfully." };
}

/**
 * Get the effective voter for a token (handles delegation chain).
 * Returns the actual token that should cast the vote.
 */
export async function getEffectiveVoter(
  ballotId: string,
  tokenHash: string,
): Promise<{ effectiveToken: string; isDelegated: boolean }> {
  const token = await prisma.voterToken.findUnique({
    where: { tokenHash },
  });

  if (!token || token.ballotId !== ballotId) {
    throw badRequest("Invalid token.");
  }

  // If this token delegates to another, follow the chain
  if (token.delegatedTo) {
    const delegate = await prisma.voterToken.findUnique({
      where: { id: token.delegatedTo },
    });

    if (delegate) {
      return { effectiveToken: delegate.tokenHash, isDelegated: true };
    }
  }

  return { effectiveToken: tokenHash, isDelegated: false };
}
