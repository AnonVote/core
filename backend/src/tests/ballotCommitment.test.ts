/**
 * Ballot commitment tests — Issue #86.
 *
 * Covers canonicalization determinism, the lifecycle points where a commitment
 * is computed/anchored, and verification. The Soroban read is injected via
 * `opts.fetchCommitment` so none of this needs a deployed contract.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import {
  canonicalBallotPayload,
  computeBallotCommitment,
} from "../utils/commitment";
import { activateBallot } from "../services/ballotEngine";
import { verifyBallotCommitment } from "../services/verificationService";

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

const DEADLINE = new Date(Date.now() + 7 * 24 * 3600_000);

// A well-formed v1 envelope. The server never decrypts it.
const HASH = "c".repeat(64);

const CIPHERTEXT =
  "v1:bmFjbFB1YmxpY0tleUJhc2U2NEV4YW1wbGVWYWx1ZUFB:aXZCYXNlNjQxMg==:Y2lwaGVydGV4dEJhc2U2NA==";

let cookie: string[];
let eligibilityListId: string;

beforeAll(async () => {
  await cleanDb();

  await request(app).post("/api/organizations").send({
    name: "Commitment Test Org",
    email: "commitment@test.org",
    password: "password123",
  });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Commitment Test Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"] as any;

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createBallotViaApi(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Commitment topic",
      options: ["Alpha", "Beta"],
      eligibilityListId,
      deadline: DEADLINE.toISOString(),
      ...overrides,
    });
  return res;
}

describe("canonicalization", () => {
  it("is deterministic for identical input", () => {
    const input = {
      topic: "Same",
      descriptionHash: HASH,
      options: [{ text: "A" }, { text: "B" }],
      deadline: DEADLINE,
    };
    expect(computeBallotCommitment(input)).toBe(computeBallotCommitment(input));
  });

  it("is independent of option ordering", () => {
    const base = {
      topic: "Order",
      descriptionHash: null,
      deadline: DEADLINE,
    };
    const forward = computeBallotCommitment({
      ...base,
      options: [{ text: "A" }, { text: "B" }, { text: "C" }],
    });
    const shuffled = computeBallotCommitment({
      ...base,
      options: [{ text: "C" }, { text: "A" }, { text: "B" }],
    });
    expect(forward).toBe(shuffled);
  });

  it("changes when the topic changes", () => {
    const base = {
      descriptionHash: null,
      options: [{ text: "A" }, { text: "B" }],
      deadline: DEADLINE,
    };
    expect(computeBallotCommitment({ ...base, topic: "One" })).not.toBe(
      computeBallotCommitment({ ...base, topic: "Two" }),
    );
  });

  it("changes when the description content changes", () => {
    const base = {
      topic: "Fixed",
      options: [{ text: "A" }, { text: "B" }],
      deadline: DEADLINE,
    };
    expect(
      computeBallotCommitment({ ...base, descriptionHash: HASH }),
    ).not.toBe(
      computeBallotCommitment({ ...base, descriptionHash: "b".repeat(64) }),
    );
  });

  it("is UNAFFECTED by re-encrypting the same description", () => {
    // The regression this design exists to prevent: encrypting identical content
    // twice yields different envelopes, so committing the ciphertext would make a
    // routine password change permanently invalidate a write-once commitment.
    const base = {
      topic: "Fixed",
      descriptionHash: HASH,
      options: [{ text: "A" }, { text: "B" }],
      deadline: DEADLINE,
    };
    expect(computeBallotCommitment(base)).toBe(computeBallotCommitment(base));
  });

  it("changes when the deadline changes", () => {
    const base = {
      topic: "Fixed",
      descriptionHash: null,
      options: [{ text: "A" }, { text: "B" }],
    };
    expect(
      computeBallotCommitment({ ...base, deadline: DEADLINE }),
    ).not.toBe(
      computeBallotCommitment({
        ...base,
        deadline: new Date(DEADLINE.getTime() + 1000),
      }),
    );
  });

  it("treats a null ciphertext as an empty string, so legacy ballots hash", () => {
    const base = {
      topic: "Legacy",
      options: [{ text: "A" }, { text: "B" }],
      deadline: DEADLINE,
    };
    expect(computeBallotCommitment({ ...base, descriptionHash: null })).toBe(
      computeBallotCommitment({ ...base, descriptionHash: "" }),
    );
    expect(
      JSON.parse(canonicalBallotPayload({ ...base, descriptionHash: null }))
        .descriptionHash,
    ).toBe("");
  });
});

describe("cross-implementation parity", () => {
  // Shared fixture — frontend/src/tests/orgCrypto.test.ts asserts the identical
  // value. If these two ever diverge, commitment verification silently breaks
  // for every ballot, so both suites pin the same constant.
  const FIXTURE = {
    topic: "  Annual budget vote  ",
    descriptionHash: "a".repeat(64),
    options: [{ text: "Charlie" }, { text: " Alpha " }, { text: "Bravo" }],
    deadline: "2027-01-15T12:00:00.000Z",
  };

  it("canonicalizes with a trimmed topic and sorted, trimmed options", () => {
    expect(canonicalBallotPayload(FIXTURE)).toBe(
      '{"topic":"Annual budget vote","descriptionHash":"' +
        "a".repeat(64) +
        '","options":["Alpha","Bravo","Charlie"],"deadline":"2027-01-15T12:00:00.000Z"}',
    );
  });

  it("hashes the shared fixture to the pinned value", () => {
    expect(computeBallotCommitment(FIXTURE)).toBe(
      "28abb03f3022d54e827d2a4215945ddfb4df0e698e9815300289470bf403997c",
    );
  });
});

describe("ballot lifecycle", () => {
  it("stores the description ciphertext verbatim", async () => {
    const res = await createBallotViaApi({
      descriptionCiphertext: CIPHERTEXT,
      descriptionHash: HASH,
    });
    expect(res.status).toBe(201);

    const row = await prisma.ballot.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row?.descriptionCiphertext).toBe(CIPHERTEXT);
    expect(row?.descriptionKeyVersion).toBe(1);
  });

  it("has no plaintext description column", async () => {
    const cols: { column_name: string }[] = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Ballot'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("descriptionCiphertext");
    expect(names).not.toContain("description");
  });

  it("rejects a malformed description envelope", async () => {
    const res = await createBallotViaApi({
      descriptionCiphertext: "not-an-envelope",
    });
    expect(res.status).toBe(400);
  });

  it("computes a commitment at creation", async () => {
    const res = await createBallotViaApi();
    const row = await prisma.ballot.findUnique({
      where: { id: res.body.data.id },
      include: { options: true },
    });
    expect(row?.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.commitmentHash).toBe(
      computeBallotCommitment({
        topic: row!.topic,
        descriptionHash: row!.descriptionHash,
        options: row!.options,
        deadline: row!.deadline,
      }),
    );
  });

  it("recomputes the commitment on a DRAFT edit", async () => {
    const res = await createBallotViaApi();
    const ballotId = res.body.data.id;
    const before = (
      await prisma.ballot.findUnique({ where: { id: ballotId } })
    )?.commitmentHash;

    await request(app)
      .patch(`/api/ballots/${ballotId}`)
      .set("Cookie", cookie)
      .send({ topic: "An edited topic" })
      .expect(200);

    const after = await prisma.ballot.findUnique({ where: { id: ballotId } });
    expect(after?.commitmentHash).not.toBe(before);
    expect(after?.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("persists the commitment at DRAFT → ACTIVE activation", async () => {
    const res = await createBallotViaApi({
      descriptionCiphertext: CIPHERTEXT,
      descriptionHash: HASH,
    });
    const ballotId = res.body.data.id;

    await activateBallot(ballotId);

    const row = await prisma.ballot.findUnique({
      where: { id: ballotId },
      include: { options: true },
    });
    expect(row?.status).toBe("ACTIVE");
    expect(row?.commitmentHash).toBe(
      computeBallotCommitment({
        topic: row!.topic,
        descriptionHash: row!.descriptionHash,
        options: row!.options,
        deadline: row!.deadline,
      }),
    );
  });
});

describe("verification", () => {
  it("reports verified when the chain value matches", async () => {
    const res = await createBallotViaApi();
    const ballotId = res.body.data.id;
    const stored = (
      await prisma.ballot.findUnique({ where: { id: ballotId } })
    )!.commitmentHash!;

    const result = await verifyBallotCommitment(ballotId, {
      fetchCommitment: async () => stored,
    });
    expect(result.status).toBe("verified");
    expect(result.source).toBe("chain");
    expect(result.onChain).toBe(stored);
  });

  it("reports mismatch when the ballot content changed after anchoring", async () => {
    const res = await createBallotViaApi();
    const ballotId = res.body.data.id;
    const anchored = (
      await prisma.ballot.findUnique({ where: { id: ballotId } })
    )!.commitmentHash!;

    // Tamper with the topic directly, as a database compromise would.
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { topic: "Tampered topic" },
    });

    const result = await verifyBallotCommitment(ballotId, {
      fetchCommitment: async () => anchored,
    });
    expect(result.status).toBe("mismatch");
    expect(result.expected).not.toBe(result.onChain);
  });

  it("falls back to the DB copy, then reports unanchored", async () => {
    const res = await createBallotViaApi();
    const ballotId = res.body.data.id;

    // Chain unavailable → DB copy is used and honestly labelled.
    const viaDb = await verifyBallotCommitment(ballotId, {
      fetchCommitment: async () => null,
    });
    expect(viaDb.status).toBe("verified");
    expect(viaDb.source).toBe("database");

    // Neither chain nor DB → unanchored rather than a false claim.
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { commitmentHash: null },
    });
    const unanchored = await verifyBallotCommitment(ballotId, {
      fetchCommitment: async () => null,
    });
    expect(unanchored.status).toBe("unanchored");
    expect(unanchored.source).toBe("none");
    expect(unanchored.onChain).toBeNull();
  });

  it("exposes verification over the public endpoint", async () => {
    const res = await createBallotViaApi();
    const ballotId = res.body.data.id;

    const verifyRes = await request(app).get(
      `/api/ballots/${ballotId}/commitment`,
    );
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.commitmentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyRes.body.data.status).toBe("verified");
  });
});
