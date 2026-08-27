import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";
import { randomBytes } from "crypto";
import { badRequest, notFound, ballotNotEditable } from "../utils/errors";
import { sendBallotCreatedEmail } from "./emailService";
import {
  sorobanRecordBallot,
  sorobanRecordBallotCommitment,
} from "./sorobanService";
import { writeRecord } from "./stellarService";
import { logger } from "../utils/logger";
import { computeBallotCommitment } from "../utils/commitment";

/** Envelope written by the browser: "v1:" + b64(ephPub) + ":" + b64(iv) + ":" + b64(ct) */
const DESCRIPTION_ENVELOPE_RE = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
const MAX_DESCRIPTION_CIPHERTEXT = 12_000;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

/** The browser supplies sha256(plaintext); the server can only check its shape. */
export function assertDescriptionHash(value: string): void {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    throw badRequest("descriptionHash must be 64 hex characters");
  }
}

/**
 * Shape-checks a description envelope. The server cannot decrypt it — this only
 * guarantees a stored value is well-formed, so the commitment stays meaningful.
 */
export function assertDescriptionEnvelope(value: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("descriptionCiphertext must be a non-empty string");
  }
  if (value.length > MAX_DESCRIPTION_CIPHERTEXT) {
    throw badRequest(
      `descriptionCiphertext must be at most ${MAX_DESCRIPTION_CIPHERTEXT} characters`,
    );
  }
  if (!DESCRIPTION_ENVELOPE_RE.test(value)) {
    throw badRequest(
      'descriptionCiphertext must use the "v1:ephPub:iv:ciphertext" envelope',
    );
  }
}

/**
 * Create a new ballot with per-ballot encryption key and Stellar anchoring.
 *
 * The ballot_key is stored in a separate ballot_keys table and never returned
 * in any API response. If the Stellar anchor write fails, the ballot is still
 * created with anchor_status: FAILED and a retry queue row is inserted.
 */
export async function createBallot(
  orgId: string,
  topic: string,
  options: string[],
  eligibilityListId: string,
  deadline: Date,
  allowWeightedVoting = false,
  startTime?: Date,
  autoFinalise = false,
  descriptionCiphertext?: string | null,
  descriptionHash?: string | null,
) {
  // Validate topic
  if (!topic?.trim()) throw badRequest("Ballot topic is required");
  if (topic.trim().length > 200)
    throw badRequest("Ballot topic must be at most 200 characters");

  // Validate options
  if (!options || options.length < 2)
    throw badRequest("At least two options are required");
  if (options.length > 10)
    throw badRequest("Maximum 10 options allowed");
  for (const opt of options) {
    if (!opt?.trim()) throw badRequest("All options must be non-empty");
    if (opt.trim().length > 100)
      throw badRequest("Each option must be at most 100 characters");
  }
  // Check for duplicates (case-insensitive)
  const seen = new Set<string>();
  for (const opt of options) {
    const normalized = opt.trim().toLowerCase();
    if (seen.has(normalized)) {
      throw badRequest("Duplicate options are not allowed");
    }
    seen.add(normalized);
  }

  // The server never decrypts a description; it only checks the envelope shape so
  // an unreadable blob cannot be stored and silently break the commitment later.
  if (descriptionCiphertext != null) {
    assertDescriptionEnvelope(descriptionCiphertext);
    if (descriptionHash == null) {
      throw badRequest(
        "descriptionHash is required whenever descriptionCiphertext is set",
      );
    }
  }
  if (descriptionHash != null) {
    assertDescriptionHash(descriptionHash);
  }

  // Validate deadline — must be at least 1 hour in the future
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  if (deadline <= oneHourFromNow)
    throw badRequest("Deadline must be at least 1 hour in the future");

  const eligibilityList = await prisma.eligibilityList.findUnique({
    where: { id: eligibilityListId },
  });
  if (!eligibilityList) throw badRequest("Eligibility list not found");

  // Generate per-ballot AES-256 encryption key
  const ballotKey = randomBytes(32).toString("hex");

  // Create ballot with status DRAFT
  const ballot = await prisma.ballot.create({
    data: {
      organizationId: orgId,
      topic: topic.trim(),
      deadline,
      startTime: startTime ?? null,
      eligibilityListId,
      allowWeightedVoting,
      autoFinalise,
      status: "DRAFT",
      optionCount: options.length,
      descriptionCiphertext: descriptionCiphertext ?? null,
      descriptionKeyVersion: descriptionCiphertext ? 1 : null,
      descriptionHash: descriptionHash ?? null,
      options: {
        create: options.map((text) => ({ text: text.trim() })),
      },
      ballotKey: {
        create: { key: ballotKey },
      },
    },
    include: { options: true },
  });

  // Commitment is computed once the option rows exist. It is recomputed on every
  // DRAFT edit and anchored at activation, when the content is finally frozen.
  const commitmentHash = computeBallotCommitment({
    topic: ballot.topic,
    descriptionHash: ballot.descriptionHash,
    options: ballot.options,
    deadline: ballot.deadline,
  });
  await prisma.ballot.update({
    where: { id: ballot.id },
    data: { commitmentHash },
  });
  ballot.commitmentHash = commitmentHash;

  // Attempt Stellar anchor — use manageData write with hashIdentifier(ballotId)
  // If it fails, set anchor_status: FAILED and insert retry queue row.
  // Do NOT fail ballot creation.
  try {
    const ballotIdHash = hashIdentifier(ballot.id);
    const stellarResult = await writeRecord({
      type: "BALLOT_CREATED",
      ballotIdHash,
    });

    if (stellarResult.txHash) {
      await prisma.ballot.update({
        where: { id: ballot.id },
        data: {
          stellarTxId: stellarResult.txHash,
          anchorStatus: "ANCHORED",
        },
      });
    } else {
      // Stellar write returned empty — treat as failure
      await prisma.ballot.update({
        where: { id: ballot.id },
        data: { anchorStatus: "FAILED" },
      });
      await prisma.ballotAnchorRetry.upsert({
        where: { ballotId: ballot.id },
        create: { ballotId: ballot.id, retryCount: 0 },
        update: {},
      });
    }
  } catch (err) {
    console.error("[Stellar] Ballot anchor failed at creation:", err);
    await prisma.ballot.update({
      where: { id: ballot.id },
      data: { anchorStatus: "FAILED" },
    });
    await prisma.ballotAnchorRetry.upsert({
      where: { ballotId: ballot.id },
      create: { ballotId: ballot.id, retryCount: 0 },
      update: {},
    });
  }

  // Send confirmation email to org admin — non-blocking
  prisma.organization
    .findUnique({ where: { id: orgId }, select: { email: true, name: true } })
    .then((org) => {
      if (org) {
        console.log(`[Email] Sending ballot created email to ${org.email}`);
        sendBallotCreatedEmail({
          to: org.email,
          orgName: org.name,
          topic: ballot.topic,
          deadline: ballot.deadline,
          ballotId: ballot.id,
        })
          .then(() =>
            console.log(
              `[Email] Ballot created email delivered to ${org.email}`,
            ),
          )
          .catch((err) =>
            console.error("[Email] Ballot created send error:", err),
          );
      } else {
        console.warn("[Email] Org not found for ballot created email");
      }
    })
    .catch((err) =>
      console.error("[Email] Failed to fetch org for email:", err),
    );

  // Return ballot without ballot_key — never expose the key
  return {
    id: ballot.id,
    topic: ballot.topic,
    status: ballot.status,
    deadline: ballot.deadline,
    startTime: ballot.startTime,
    anchorStatus: ballot.anchorStatus,
    stellarTxId: ballot.stellarTxId,
    options: ballot.options,
    optionCount: ballot.optionCount,
  };
}

/**
 * Get ballots for an organization with optional status filter and pagination.
 */
export async function getBallotsByOrg(
  orgId: string,
  opts: {
    status?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: orgId,
    deletedAt: null,
  };
  if (opts.status) {
    where.status = opts.status;
  }

  const [ballots, totalCount] = await Promise.all([
    prisma.ballot.findMany({
      where,
      include: {
        options: true,
        eligibilityList: { include: { _count: { select: { entries: true } } } },
        _count: { select: { votes: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.ballot.count({ where }),
  ]);

  // Get tokens issued count per ballot from audit events
  const ballotIds = ballots.map((b) => b.id);
  const tokenCounts = await prisma.auditEvent.groupBy({
    by: ["ballotId"],
    where: {
      ballotId: { in: ballotIds },
      eventType: "TOKEN_ISSUED",
    },
    _count: { id: true },
  });
  const tokenCountMap = Object.fromEntries(
    tokenCounts.map((t) => [t.ballotId, t._count.id]),
  );

  return {
    data: ballots.map((b) => ({
      id: b.id,
      topic: b.topic,
      status: b.status,
      deadline: b.deadline,
      startTime: b.startTime,
      createdAt: b.createdAt,
      options: b.options,
      optionCount: b.optionCount,
      eligibleVoters: b.eligibilityList._count.entries,
      tokensIssued: tokenCountMap[b.id] ?? 0,
      votesCast: b._count.votes,
      anchorStatus: b.anchorStatus,
      stellarTxId: b.stellarTxId,
      // Opaque to everyone but the owning org; the dashboard decrypts in place.
      descriptionCiphertext: b.descriptionCiphertext,
      descriptionHash: b.descriptionHash,
      commitmentHash: b.commitmentHash,
    })),
    total_count: totalCount,
    page,
    limit,
  };
}

/**
 * Get a single ballot by ID (public).
 * Never includes ballot_key.
 */
export async function getBallotById(id: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id, deletedAt: null },
    include: { options: true },
  });
  if (!ballot) throw notFound("Ballot not found");
  return ballot;
}

/**
 * Get an aggregated summary for a single ballot — ballot + options + stats
 * (eligible voters, tokens issued, votes cast) + deadline info in one call.
 *
 * Replaces the previous pattern where the ballot detail page had to fetch
 * the ballot, then separately fetch audit counts, then separately fetch
 * eligibility list counts (issue: N+1 queries / multiple frontend requests).
 */
export async function getBallotSummary(id: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id, deletedAt: null },
    include: {
      options: true,
      eligibilityList: { include: { _count: { select: { entries: true } } } },
      _count: { select: { votes: true } },
    },
  });
  if (!ballot) throw notFound("Ballot not found");

  // Tokens issued is derived from audit events, not a direct relation on
  // Ballot, so it needs its own query — but it's the only extra round trip
  // (down from the 3+ separate requests the frontend previously made).
  const tokensIssued = await prisma.auditEvent.count({
    where: { ballotId: id, eventType: "TOKEN_ISSUED" },
  });

  return {
    id: ballot.id,
    topic: ballot.topic,
    status: ballot.status,
    deadline: ballot.deadline,
    startTime: ballot.startTime,
    createdAt: ballot.createdAt,
    options: ballot.options,
    optionCount: ballot.optionCount,
    allowWeightedVoting: ballot.allowWeightedVoting,
    allowRankedChoice: ballot.allowRankedChoice,
    maxRankings: ballot.maxRankings,
    eligibleVoters: ballot.eligibilityList._count.entries,
    tokensIssued,
    votesCast: ballot._count.votes,
    anchorStatus: ballot.anchorStatus,
    stellarTxId: ballot.stellarTxId,
  };
}

/**
 * Update a ballot — only allowed when status === DRAFT.
 */
export async function updateBallot(
  ballotId: string,
  orgId: string,
  data: {
    topic?: string;
    deadline?: Date;
    eligibilityListId?: string;
    options?: string[];
    /** null clears the description; undefined leaves it untouched. */
    descriptionCiphertext?: string | null;
    descriptionHash?: string | null;
  },
) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
    include: { _count: { select: { votes: true } } },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId)
    throw badRequest("You can only edit your own ballots");

  // State machine: only DRAFT ballots can be edited
  if (ballot.status !== "DRAFT") {
    throw ballotNotEditable();
  }

  const hasVotes = ballot._count.votes > 0;

  if (hasVotes && (data.options || data.eligibilityListId)) {
    throw badRequest(
      "Options and eligibility list cannot be changed after votes have been cast",
    );
  }

  if (data.topic !== undefined && !data.topic.trim())
    throw badRequest("Ballot topic cannot be empty");
  if (data.topic && data.topic.trim().length > 200)
    throw badRequest("Ballot topic must be at most 200 characters");
  if (data.deadline !== undefined && data.deadline <= new Date())
    throw badRequest("Deadline must be in the future");
  if (data.options !== undefined) {
    if (data.options.length < 2)
      throw badRequest("At least two options are required");
    if (data.options.length > 10)
      throw badRequest("Maximum 10 options allowed");
  }

  if (data.descriptionCiphertext != null) {
    assertDescriptionEnvelope(data.descriptionCiphertext);
    if (data.descriptionHash == null) {
      throw badRequest(
        "descriptionHash is required whenever descriptionCiphertext is set",
      );
    }
  }
  if (data.descriptionHash != null) {
    assertDescriptionHash(data.descriptionHash);
  }

  if (data.eligibilityListId) {
    const list = await prisma.eligibilityList.findUnique({
      where: { id: data.eligibilityListId },
    });
    if (!list) throw badRequest("Eligibility list not found");
  }

  return prisma.$transaction(async (tx) => {
    // Replace options if provided
    if (data.options) {
      await tx.option.deleteMany({ where: { ballotId } });
      await tx.option.createMany({
        data: data.options.map((text) => ({ ballotId, text: text.trim() })),
      });
      // Update denormalized option count
      await tx.ballot.update({
        where: { id: ballotId },
        data: { optionCount: data.options.length },
      });
    }

    const updated = await tx.ballot.update({
      where: { id: ballotId },
      data: {
        ...(data.topic && { topic: data.topic.trim() }),
        ...(data.deadline && { deadline: data.deadline }),
        ...(data.eligibilityListId && {
          eligibilityListId: data.eligibilityListId,
        }),
        ...(data.descriptionCiphertext !== undefined && {
          descriptionCiphertext: data.descriptionCiphertext,
          descriptionKeyVersion: data.descriptionCiphertext ? 1 : null,
          descriptionHash: data.descriptionHash ?? null,
        }),
      },
      include: { options: true },
    });

    // Audit a description change. The server holds no key, so the "before"
    // snapshot is simply the previous ciphertext — already encrypted to this
    // org and readable only by it. Deriving it server-side (rather than letting
    // the client supply it) keeps the audit record trustworthy.
    if (
      data.descriptionCiphertext !== undefined &&
      data.descriptionCiphertext !== ballot.descriptionCiphertext
    ) {
      await tx.auditEvent.create({
        data: {
          ballotId,
          organizationId: orgId,
          eventType: "BALLOT_METADATA_CHANGED",
          metadataCiphertext: ballot.descriptionCiphertext,
        },
      });
    }

    // Recompute from the written row, not from `data` — options may have been
    // replaced above and the commitment must match what is actually stored.
    const commitmentHash = computeBallotCommitment({
      topic: updated.topic,
      descriptionHash: updated.descriptionHash,
      options: updated.options,
      deadline: updated.deadline,
    });

    return tx.ballot.update({
      where: { id: ballotId },
      data: { commitmentHash },
      include: { options: true },
    });
  });
}

/**
 * Activate a ballot — transition DRAFT → ACTIVE (Issue #86).
 *
 * This is the commitment point: `updateBallot` only permits edits while the
 * ballot is DRAFT, so activation is the moment its content is frozen. The
 * commitment is persisted first (the DB copy is the fallback that keeps
 * verification working without a deployed contract), then anchored on-chain
 * fire-and-forget — mirroring how `resultEngine` anchors `resultHash`.
 *
 * On-chain failure never blocks activation; a ballot that cannot be anchored is
 * still a valid ballot, it simply reports as unanchored.
 */
export async function activateBallot(ballotId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
    include: { options: true },
  });
  if (!ballot) throw notFound("Ballot not found");

  // Only DRAFT ballots can be activated
  if (ballot.status !== "DRAFT") return;

  // Recompute rather than trusting the stored value, so the anchored commitment
  // always matches the content actually being frozen.
  const commitmentHash = computeBallotCommitment({
    topic: ballot.topic,
    descriptionHash: ballot.descriptionHash,
    options: ballot.options,
    deadline: ballot.deadline,
  });

  await prisma.ballot.update({
    where: { id: ballotId },
    data: { status: "ACTIVE", commitmentHash },
  });

  const ballotIdHash = hashIdentifier(ballotId);
  sorobanRecordBallotCommitment(ballotIdHash, commitmentHash)
    .then(async (txHash) => {
      if (txHash) {
        await prisma.ballot.update({
          where: { id: ballotId },
          data: { commitmentTxId: txHash, commitmentAnchoredAt: new Date() },
        });
        logger.info("ballot_commitment_anchored", { ballotId, txHash });
      } else {
        logger.warn("ballot_commitment_not_anchored", {
          ballotId,
          reason: "soroban contract not configured",
        });
      }
    })
    .catch((err) =>
      logger.error("ballot_commitment_anchor_failed", { ballotId, error: err }),
    );

  return { ballotId, commitmentHash };
}

/**
 * Close a ballot — transition ACTIVE → CLOSED.
 */
export async function closeBallot(ballotId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
  });
  if (!ballot) throw notFound("Ballot not found");

  // Only ACTIVE ballots can be closed
  if (ballot.status !== "ACTIVE") return;

  await prisma.ballot.update({
    where: { id: ballotId },
    data: { status: "CLOSED" },
  });
}

/**
 * Finalise a ballot — transition CLOSED → FINALISED.
 */
export async function finaliseBallot(ballotId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
  });
  if (!ballot) throw notFound("Ballot not found");

  if (ballot.status !== "CLOSED") return;

  await prisma.ballot.update({
    where: { id: ballotId },
    data: { status: "FINALISED" },
  });
}

/**
 * Get ballots that should transition from DRAFT → ACTIVE (start_time passed).
 */
export async function getDraftBallotsToActivate() {
  const now = new Date();
  return prisma.ballot.findMany({
    where: {
      status: "DRAFT",
      deletedAt: null,
      OR: [
        { startTime: { lte: now } },
        { startTime: null },
      ],
    },
  });
}

/**
 * Get ballots that should transition from ACTIVE → CLOSED (deadline passed).
 */
export async function getActiveExpiredBallots() {
  return prisma.ballot.findMany({
    where: {
      status: "ACTIVE",
      deadline: { lt: new Date() },
      deletedAt: null,
    },
  });
}

/**
 * Retry Stellar anchor for a ballot that previously failed.
 */
export async function retryBallotAnchor(ballotId: string, orgId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId)
    throw badRequest("You can only retry anchor for your own ballots");

  if (ballot.anchorStatus === "ANCHORED") {
    return {
      id: ballot.id,
      anchorStatus: ballot.anchorStatus,
      stellarTxId: ballot.stellarTxId,
    };
  }

  try {
    const ballotIdHash = hashIdentifier(ballot.id);
    const stellarResult = await writeRecord({
      type: "BALLOT_CREATED",
      ballotIdHash,
    });

    if (stellarResult.txHash) {
      await prisma.ballot.update({
        where: { id: ballotId },
        data: {
          stellarTxId: stellarResult.txHash,
          anchorStatus: "ANCHORED",
        },
      });
      // Remove from retry queue
      await prisma.ballotAnchorRetry.deleteMany({
        where: { ballotId },
      }).catch((err) =>
        logger.warn("ballot_anchor_retry_delete_failed", {
          ballotId,
          error: err,
        }),
      );
      return {
        id: ballotId,
        anchorStatus: "ANCHORED" as const,
        stellarTxId: stellarResult.txHash,
      };
    } else {
      // Increment retry count
      await prisma.ballotAnchorRetry.upsert({
        where: { ballotId },
        create: { ballotId, retryCount: 1 },
        update: { retryCount: { increment: 1 } },
      });
      return {
        id: ballotId,
        anchorStatus: "FAILED" as const,
        stellarTxId: null,
      };
    }
  } catch (err) {
    console.error(`[Stellar] Retry anchor failed for ballot ${ballotId}:`, err);
    await prisma.ballotAnchorRetry.upsert({
      where: { ballotId },
      create: { ballotId, retryCount: 1 },
      update: { retryCount: { increment: 1 } },
    });
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { anchorStatus: "FAILED" },
    });
    return {
      id: ballotId,
      anchorStatus: "FAILED" as const,
      stellarTxId: null,
    };
  }
}

/**
 * Background worker to retry pending Stellar anchors.
 */
export async function processPendingAnchors() {
  const pending = await prisma.ballot.findMany({
    where: { anchorStatus: "PENDING" },
  });

  if (pending.length === 0) return;

  console.log(`[Anchor] Processing ${pending.length} pending ballots...`);

  for (const ballot of pending) {
    try {
      const ballotIdHash = hashIdentifier(ballot.id);
      const stellarResult = await writeRecord({
        type: "BALLOT_CREATED",
        ballotIdHash,
      });
      if (stellarResult.txHash) {
        await prisma.ballot.update({
          where: { id: ballot.id },
          data: {
            stellarTxId: stellarResult.txHash,
            anchorStatus: "ANCHORED",
          },
        });
        console.log(`[Anchor] Ballot ${ballot.id} anchored: ${stellarResult.txHash}`);
      }
    } catch (err) {
      console.error(`[Anchor] Retry failed for ballot ${ballot.id}:`, err);
    }
  }
}

/**
 * Soft delete a ballot — only allowed when status === DRAFT.
 * Never hard deletes a ballot that has had voter activity.
 */
export async function deleteBallot(ballotId: string, orgId: string) {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
    include: {
      _count: {
        select: { votes: true },
      },
    },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId) {
    throw badRequest("You can only delete your own ballots");
  }

  // Only DRAFT ballots can be deleted
  if (ballot.status !== "DRAFT") {
    throw ballotNotEditable("Only draft ballots can be deleted");
  }

  // Soft delete — set deletedAt timestamp
  await prisma.ballot.update({
    where: { id: ballotId },
    data: { deletedAt: new Date() },
  });
}