/**
 * Audit trail and backfill for encrypted ballot metadata — Issue #86.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { backfillBallotCommitments } from "../scripts/backfillBallotCommitments";
import { computeBallotCommitment } from "../utils/commitment";

async function cleanDb() {
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.ballotKey.deleteMany();
  await prisma.result.deleteMany();
  await prisma.option.deleteMany();
  await prisma.tokenDeliveryRetry.deleteMany();
  await prisma.ballotAnchorRetry.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationKey.deleteMany();
  await prisma.organization.deleteMany();
}

const envelope = (tag: string) =>
  `v1:${Buffer.from("eph" + tag).toString("base64")}:${Buffer.from(
    "iv" + tag,
  ).toString("base64")}:${Buffer.from("ct" + tag).toString("base64")}`;

const DEADLINE = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

let cookie: string[];
let eligibilityListId: string;

beforeEach(async () => {
  await cleanDb();

  await request(app).post("/api/organizations").send({
    name: "Metadata Audit Org",
    email: "metaaudit@test.org",
    password: "password123",
  });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Metadata Audit Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"] as any;

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createBallot(descriptionCiphertext?: string) {
  const res = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Audit topic",
      options: ["Yes", "No"],
      eligibilityListId,
      deadline: DEADLINE,
      ...(descriptionCiphertext ? { descriptionCiphertext } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("BALLOT_METADATA_CHANGED", () => {
  it("is emitted when a description is first set, with a null before-snapshot", async () => {
    const ballotId = await createBallot();

    await request(app)
      .patch(`/api/ballots/${ballotId}`)
      .set("Cookie", cookie)
      .send({ descriptionCiphertext: envelope("first") })
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { ballotId, eventType: "BALLOT_METADATA_CHANGED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadataCiphertext).toBeNull();
  });

  it("records the previous ciphertext as the before-snapshot on update", async () => {
    const ballotId = await createBallot(envelope("old"));

    await request(app)
      .patch(`/api/ballots/${ballotId}`)
      .set("Cookie", cookie)
      .send({ descriptionCiphertext: envelope("new") })
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { ballotId, eventType: "BALLOT_METADATA_CHANGED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadataCiphertext).toBe(envelope("old"));

    const row = await prisma.ballot.findUnique({ where: { id: ballotId } });
    expect(row?.descriptionCiphertext).toBe(envelope("new"));
  });

  it("is not emitted when the description is unchanged", async () => {
    const ballotId = await createBallot(envelope("same"));

    await request(app)
      .patch(`/api/ballots/${ballotId}`)
      .set("Cookie", cookie)
      .send({ topic: "A new topic", descriptionCiphertext: envelope("same") })
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { ballotId, eventType: "BALLOT_METADATA_CHANGED" },
    });
    expect(events).toHaveLength(0);
  });

  it("keeps the CSV export parseable with the new column", async () => {
    const ballotId = await createBallot(envelope("old"));
    await request(app)
      .patch(`/api/ballots/${ballotId}`)
      .set("Cookie", cookie)
      .send({ descriptionCiphertext: envelope("new") })
      .expect(200);

    const res = await request(app)
      .get(`/api/admin/audit/${ballotId}?format=csv`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe(
      "eventType,createdAt,stellarTxId,stellarLedgerAt,metadataCiphertext",
    );

    const headerCols = lines[0].split(",").length;
    // Every row must have the same column count as the header.
    for (const line of lines.slice(1)) {
      expect(line.match(/","/g)!.length + 1).toBe(headerCols);
    }
    expect(res.text).toContain(envelope("old"));
  });
});

describe("backfillBallotCommitments", () => {
  it("computes commitments for ballots that lack one", async () => {
    const ballotId = await createBallot();
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { commitmentHash: null },
    });

    const summary = await backfillBallotCommitments();
    expect(summary.computed).toBeGreaterThanOrEqual(1);

    const row = await prisma.ballot.findUnique({
      where: { id: ballotId },
      include: { options: true },
    });
    expect(row?.commitmentHash).toBe(
      computeBallotCommitment({
        topic: row!.topic,
        descriptionCiphertext: row!.descriptionCiphertext,
        options: row!.options,
        deadline: row!.deadline,
      }),
    );
  });

  it("is idempotent — a second run changes nothing", async () => {
    await createBallot();
    await prisma.ballot.updateMany({ data: { commitmentHash: null } });

    const first = await backfillBallotCommitments();
    const second = await backfillBallotCommitments();

    expect(first.computed).toBeGreaterThanOrEqual(1);
    expect(second.computed).toBe(0);
    expect(second.unchanged).toBe(second.scanned);
    expect(second.failed).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const ballotId = await createBallot();
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { commitmentHash: null },
    });

    await backfillBallotCommitments({ dryRun: true });

    const row = await prisma.ballot.findUnique({ where: { id: ballotId } });
    expect(row?.commitmentHash).toBeNull();
  });
});
