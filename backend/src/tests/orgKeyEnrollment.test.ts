/**
 * Organization X25519 key enrollment and password re-encryption — Issue #86.
 *
 * The server never holds the private key; these tests pin the public contract
 * and, critically, the refusal that prevents a password change from silently
 * orphaning every encrypted description.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { randomBytes } from "crypto";

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

/** A syntactically valid raw 32-byte X25519 public key, base64. */
function fakePublicKey(): string {
  return randomBytes(32).toString("base64");
}

const envelope = (tag: string) =>
  `v1:${Buffer.from("eph" + tag).toString("base64")}:${Buffer.from(
    "iv" + tag,
  ).toString("base64")}:${Buffer.from("ct" + tag).toString("base64")}`;

const DEADLINE = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

let cookie: string[];
let orgId: string;
let eligibilityListId: string;

beforeEach(async () => {
  await cleanDb();

  const reg = await request(app).post("/api/organizations").send({
    name: "Key Enrollment Org",
    email: "keys@test.org",
    password: "password123",
  });
  orgId = reg.body.data.id;

  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Key Enrollment Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"] as any;

  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeBallotWithDescription(tag: string) {
  const res = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: `Ballot ${tag}`,
      options: ["Yes", "No"],
      eligibilityListId,
      deadline: DEADLINE,
      descriptionCiphertext: envelope(tag),
      descriptionHash: "a".repeat(64),
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("key enrollment", () => {
  it("mints a derivation salt at registration", async () => {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.keyDerivationSalt).toBeTruthy();
    // 16 raw bytes → 24 base64 chars
    expect(Buffer.from(org!.keyDerivationSalt!, "base64")).toHaveLength(16);
    expect(org?.publicKey).toBeNull();
  });

  it("returns the salt with a null key before enrollment", async () => {
    // The browser needs the salt to derive a keypair before it can enroll one.
    const res = await request(app).get(
      `/api/organizations/${orgId}/public-key`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBeNull();
    expect(res.body.data.keyDerivationSalt).toBeTruthy();
  });

  it("404s for an organization that does not exist", async () => {
    const res = await request(app).get(
      "/api/organizations/00000000-0000-4000-8000-000000000000/public-key",
    );
    expect(res.status).toBe(404);
  });

  it("returns salt and key once enrolled, without auth", async () => {
    const publicKey = fakePublicKey();
    await request(app)
      .post("/api/organizations/me/public-key")
      .set("Cookie", cookie)
      .send({ publicKey })
      .expect(200);

    // Deliberately unauthenticated — a public key is public.
    const res = await request(app).get(
      `/api/organizations/${orgId}/public-key`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.publicKey).toBe(publicKey);
    expect(res.body.data.keyDerivationSalt).toBeTruthy();
    expect(res.body.data.algorithm).toBe("X25519");
  });

  it("requires auth to enroll", async () => {
    const res = await request(app)
      .post("/api/organizations/me/public-key")
      .send({ publicKey: fakePublicKey() });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed public key", async () => {
    for (const bad of ["short", "!".repeat(44), randomBytes(16).toString("base64")]) {
      const res = await request(app)
        .post("/api/organizations/me/public-key")
        .set("Cookie", cookie)
        .send({ publicKey: bad });
      expect(res.status).toBe(400);
    }
  });

  it("backfills a salt for an organization that predates the feature", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { keyDerivationSalt: null },
    });

    const publicKey = fakePublicKey();
    const res = await request(app)
      .post("/api/organizations/me/public-key")
      .set("Cookie", cookie)
      .send({ publicKey })
      .expect(200);

    expect(res.body.data.keyDerivationSalt).toBeTruthy();
  });
});

describe("password change re-encryption", () => {
  it("rejects a change that would orphan encrypted descriptions", async () => {
    await makeBallotWithDescription("a");

    const res = await request(app)
      .patch("/api/organizations/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "password123", newPassword: "newpassword456" });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("orphan");

    // The password must be unchanged — the refusal is atomic.
    const stillWorks = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Key Enrollment Org", password: "password123" });
    expect(stillWorks.status).toBe(200);
  });

  it("applies password, public key and every ciphertext atomically", async () => {
    const b1 = await makeBallotWithDescription("a");
    const b2 = await makeBallotWithDescription("b");
    const newKey = fakePublicKey();

    const res = await request(app)
      .patch("/api/organizations/password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "password123",
        newPassword: "newpassword456",
        publicKey: newKey,
        reencrypted: [
          { ballotId: b1, descriptionCiphertext: envelope("a2") },
          { ballotId: b2, descriptionCiphertext: envelope("b2") },
        ],
      });
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(org?.publicKey).toBe(newKey);
    expect(org?.keyVersion).toBe(2);

    const rows = await prisma.ballot.findMany({
      where: { id: { in: [b1, b2] } },
      orderBy: { topic: "asc" },
    });
    expect(rows[0].descriptionCiphertext).toBe(envelope("a2"));
    expect(rows[1].descriptionCiphertext).toBe(envelope("b2"));

    await request(app)
      .post("/api/organizations/login")
      .send({ name: "Key Enrollment Org", password: "newpassword456" })
      .expect(200);
  });

  it("rejects an incomplete re-encryption set", async () => {
    const b1 = await makeBallotWithDescription("a");
    await makeBallotWithDescription("b");

    const res = await request(app)
      .patch("/api/organizations/password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "password123",
        newPassword: "newpassword456",
        reencrypted: [
          { ballotId: b1, descriptionCiphertext: envelope("a2") },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("orphan");

    // Nothing was written — b1 keeps its original ciphertext.
    const row = await prisma.ballot.findUnique({ where: { id: b1 } });
    expect(row?.descriptionCiphertext).toBe(envelope("a"));
  });

  it("destroys descriptions only on an explicit opt-in", async () => {
    const b1 = await makeBallotWithDescription("a");

    const res = await request(app)
      .patch("/api/organizations/password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "password123",
        newPassword: "newpassword456",
        discardEncryptedDescriptions: true,
      });
    expect(res.status).toBe(200);

    const row = await prisma.ballot.findUnique({ where: { id: b1 } });
    expect(row?.descriptionCiphertext).toBeNull();
    expect(row?.descriptionKeyVersion).toBeNull();
  });

  it("refuses a ballot id belonging to another organization", async () => {
    await makeBallotWithDescription("a");

    // A second org with its own ballot.
    await request(app).post("/api/organizations").send({
      name: "Other Org",
      email: "other@test.org",
      password: "password123",
    });
    const otherLogin = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Other Org", password: "password123" });
    const otherCookie = otherLogin.headers["set-cookie"] as any;
    const otherList = await prisma.eligibilityList.create({ data: {} });
    const otherBallot = await request(app)
      .post("/api/ballots")
      .set("Cookie", otherCookie)
      .send({
        topic: "Other ballot",
        options: ["Yes", "No"],
        eligibilityListId: otherList.id,
        deadline: DEADLINE,
        descriptionCiphertext: envelope("z"),
        descriptionHash: "b".repeat(64),
      });

    const res = await request(app)
      .patch("/api/organizations/password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "password123",
        newPassword: "newpassword456",
        reencrypted: [
          {
            ballotId: otherBallot.body.data.id,
            descriptionCiphertext: envelope("z2"),
          },
        ],
      });

    expect(res.status).toBe(400);

    // The other org's ciphertext is untouched.
    const row = await prisma.ballot.findUnique({
      where: { id: otherBallot.body.data.id },
    });
    expect(row?.descriptionCiphertext).toBe(envelope("z"));
  });
});
