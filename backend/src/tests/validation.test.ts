/**
 * Unit tests for request validation on election and voting endpoints.
 *
 * These tests verify that the validate() middleware rejects malformed payloads
 * before they reach business logic, and that valid payloads pass through.
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";

let cookie: string[];
let ballotId: string;
let eligibilityListId: string;

beforeAll(async () => {
  // Clean slate
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.result.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();

  // Register + login org
  await request(app).post("/api/organizations").send({
    name: "Validation Test Org",
    email: "validation@test.org",
    password: "password123",
  });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Validation Test Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"];

  // Create eligibility list with one eligible voter
  const list = await prisma.eligibilityList.create({ data: {} });
  eligibilityListId = list.id;
  await prisma.eligibilityEntry.create({
    data: {
      eligibilityListId,
      identifierHash: hashIdentifier("valid@voter.com"),
    },
  });

  // Create a ballot for vote/token tests
  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Validation Test Ballot",
      options: ["Yes", "No"],
      eligibilityListId,
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;
});

afterAll(() => prisma.$disconnect());

// ---------------------------------------------------------------------------
// Validate middleware contract
// ---------------------------------------------------------------------------

describe("Validation error shape", () => {
  it("returns error=ValidationError, message, and fields array on invalid input", async () => {
    const res = await request(app).post("/api/votes").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
    expect(typeof res.body.message).toBe("string");
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields.length).toBeGreaterThan(0);
    expect(res.body.fields[0]).toHaveProperty("field");
    expect(res.body.fields[0]).toHaveProperty("message");
  });
});

// ---------------------------------------------------------------------------
// POST /api/ballots — ballot creation validation
// ---------------------------------------------------------------------------

describe("POST /api/ballots — validation", () => {
  it("accepts a valid ballot payload", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A valid topic",
        options: ["Option A", "Option B"],
        eligibilityListId,
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(201);
  });

  it("rejects missing topic", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        options: ["A", "B"],
        eligibilityListId,
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
    expect(res.body.message).toMatch(/topic/i);
  });

  it("rejects missing options", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        eligibilityListId,
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
    expect(res.body.message).toMatch(/options/i);
  });

  it("rejects options array with fewer than 2 items", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: ["Only one"],
        eligibilityListId,
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects non-array options", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: "not-an-array",
        eligibilityListId,
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects missing eligibilityListId", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: ["A", "B"],
        deadline: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/eligibilityListId/i);
  });

  it("rejects missing deadline", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: ["A", "B"],
        eligibilityListId,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/deadline/i);
  });

  it("rejects a deadline in the past", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: ["A", "B"],
        eligibilityListId,
        deadline: new Date(Date.now() - 1000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/future/i);
  });

  it("rejects a malformed deadline string", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "A topic",
        options: ["A", "B"],
        eligibilityListId,
        deadline: "not-a-date",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ISO 8601/i);
  });

  it("rejects empty body", async () => {
    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
    expect(res.body.fields.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// POST /api/votes — vote submission validation
// ---------------------------------------------------------------------------

describe("POST /api/votes — validation", () => {
  it("rejects empty body", async () => {
    const res = await request(app).post("/api/votes").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects missing ballotId", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ voterToken: "sometoken", optionId: "someoption" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ballotId/i);
  });

  it("rejects missing voterToken", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId: "someid", optionId: "someoption" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/voterToken/i);
  });

  it("rejects missing optionId", async () => {
    const res = await request(app)
      .post("/api/votes")
      .send({ ballotId: "someid", voterToken: "sometoken" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/optionId/i);
  });

  it("rejects non-numeric weight", async () => {
    const res = await request(app).post("/api/votes").send({
      ballotId: "someid",
      voterToken: "sometoken",
      optionId: "someopt",
      weight: "heavy",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/weight/i);
  });

  it("rejects non-numeric rank", async () => {
    const res = await request(app).post("/api/votes").send({
      ballotId: "someid",
      voterToken: "sometoken",
      optionId: "someopt",
      rank: "first",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rank/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tokens — token issuance validation
// ---------------------------------------------------------------------------

describe("POST /api/tokens — validation", () => {
  it("rejects missing ballotId", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ voterIdentifier: "voter@test.com" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ballotId/i);
  });

  it("rejects missing voterIdentifier", async () => {
    const res = await request(app)
      .post("/api/tokens")
      .send({ ballotId: "someid" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/voterIdentifier/i);
  });

  it("rejects empty body", async () => {
    const res = await request(app).post("/api/tokens").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });
});

// ---------------------------------------------------------------------------
// POST /api/organizations — registration validation
// ---------------------------------------------------------------------------

describe("POST /api/organizations — validation", () => {
  it("rejects missing email", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Some Org", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  it("rejects invalid email format", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Some Org", email: "not-an-email", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  it("rejects password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Some Org", email: "a@b.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
  });

  it("rejects missing name", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ email: "a@b.com", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name/i);
  });

  it("accepts a valid registration payload", async () => {
    const res = await request(app).post("/api/organizations").send({
      name: "New Valid Org",
      email: "new@valid.org",
      password: "securepass123",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("New Valid Org");
  });
});
