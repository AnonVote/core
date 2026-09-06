import { randomBytes } from "crypto";
import { prisma } from "../prisma/client";
import { badRequest, notFound } from "../utils/errors";

export interface BallotEncryptionKeyRecord {
  key: string;
  previousKey: string | null;
  rotatedAt: Date | null;
}

type BallotKeyLookupClient = {
  ballotKey: {
    findUnique: typeof prisma.ballotKey.findUnique;
  };
};

export async function getBallotEncryptionKeyRecord(
  ballotId: string,
  client: BallotKeyLookupClient = prisma,
): Promise<BallotEncryptionKeyRecord> {
  const record = await client.ballotKey.findUnique({
    where: { ballotId },
    select: { key: true, previousKey: true, rotatedAt: true },
  });

  if (!record) {
    throw notFound("Ballot encryption key not found");
  }

  return record;
}

export async function getBallotEncryptionKey(
  ballotId: string,
  client: BallotKeyLookupClient = prisma,
): Promise<string> {
  const record = await getBallotEncryptionKeyRecord(ballotId, client);
  return record.key;
}

export async function rotateBallotEncryptionKey(
  ballotId: string,
  orgId: string,
): Promise<{ ballotId: string; rotatedAt: Date }> {
  const ballot = await prisma.ballot.findUnique({
    where: { id: ballotId, deletedAt: null },
    select: { id: true, organizationId: true },
  });

  if (!ballot) throw notFound("Ballot not found");
  if (ballot.organizationId !== orgId) {
    throw badRequest("You can only rotate keys for your own ballots");
  }

  const current = await getBallotEncryptionKeyRecord(ballotId);
  const nextKey = randomBytes(32).toString("hex");
  const rotatedAt = new Date();

  await prisma.ballotKey.update({
    where: { ballotId },
    data: {
      previousKey: current.key,
      key: nextKey,
      rotatedAt,
    },
  });

  return { ballotId, rotatedAt };
}
