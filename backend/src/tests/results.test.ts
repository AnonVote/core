/**
 * Unit tests for GET /api/results/:ballotId
 *
 * Covers issue #38 — results response must include a `metadata` object
 * with total_votes, ballot_id, ballot_title, tally_timestamp, the Stellar
 * transaction id, an is_consistent flag, and an encryption_note.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { generateToken, hashToken } from "../utils/crypto";
import { tallyBallot } from "../services/resultEngine";

let ballotId: string;
let optionAId: string;
let optionBId: string;
let eligibilityListId: string;

beforeAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.result.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();

  const org = await prisma.organization.create({
    data: {
      name: "Results Metadata Test Org",
      email: "results-metadata@test.com",
      passwordHash: "irrelevant",
    },
  });

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;

  const ballot = await prisma.ballot.create({
    data: {
      organizationId: org.id,
      topic: "Results Metadata Test Ballot",
      deadline: new Date(Date.now() + 3_600_000),
      eligibilityListId,
      status: "CLOSED",
      options: { create: [{ text: "Option A" }, { text: "Option B" }] },
    },
    include: { options: true },
  });
  ballotId = ballot.id;
  optionAId = ballot.options.find((o) => o.text === "Option A")!.id;
  optionBId = ballot.options.find((o) => o.text === "Option B")!.id;

  const { encryptVote } = await import("../utils/crypto");
  const key = process.env.BALLOT_ENCRYPTION_KEY ?? "test-key-32bytes!padding123456";

  await prisma.vote.create({
    data: {
      ballotId,
      optionId: optionAId,
      encryptedPayload: encryptVote(optionAId, key),
      weight: 1,
    },
  });
  await prisma.vote.create({
    data: {
      ballotId,
      optionId: optionAId,
      encryptedPayload: encryptVote(optionAId, key),
      weight: 1,
    },
  });
  await prisma.vote.create({
    data: {
      ballotId,
      optionId: optionBId,
      encryptedPayload: encryptVote(optionBId, key),
      weight: 1,
    },
  });

  for (let i = 0; i < 3; i++) {
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(generateToken()), ballotId, used: true },
    });
  }

  await tallyBallot(ballotId, { skipSoroban: true });
});

afterAll(() => prisma.$disconnect());

describe("GET /api/results/:ballotId — metadata", () => {
  it("returns a metadata object alongside the results", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.metadata).toBeDefined();
  });

  it("includes total_votes matching the sum of option counts", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata, options } = res.body.data;

    const sum = options.reduce(
      (acc: number, o: { count: number }) => acc + o.count,
      0,
    );
    expect(metadata.total_votes).toBe(sum);
    expect(metadata.total_votes).toBe(3);
  });

  it("includes ballot_id and ballot_title", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata } = res.body.data;

    expect(metadata.ballot_id).toBe(ballotId);
    expect(metadata.ballot_title).toBe("Results Metadata Test Ballot");
  });

  it("includes a tally_timestamp", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata } = res.body.data;

    expect(metadata.tally_timestamp).toBeTruthy();
    expect(new Date(metadata.tally_timestamp).toString()).not.toBe("Invalid Date");
  });

  it("includes the Stellar transaction id field (nullable if unset)", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata } = res.body.data;

    expect(metadata).toHaveProperty("stellar_transaction_id");
  });

  it("is_consistent flag matches the underlying consistency check", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata, isConsistent } = res.body.data;

    expect(metadata.is_consistent).toBe(isConsistent);
    expect(metadata.is_consistent).toBe(true);
    // No SOROBAN_CONTRACT_ID configured in test env, so this should
    // fall back to the database-level consistency check.
    expect(metadata.consistency_source).toBe("database");
  });

  it("includes a non-empty encryption_note explaining the privacy model", async () => {
    const res = await request(app).get(`/api/results/${ballotId}`);
    const { metadata } = res.body.data;

    expect(typeof metadata.encryption_note).toBe("string");
    expect(metadata.encryption_note.length).toBeGreaterThan(0);
  });

  it("returns 404 for a ballot with no published result", async () => {
    const res = await request(app).get(
      "/api/results/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });
});
