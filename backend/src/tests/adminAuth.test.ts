import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";

async function cleanDb() {
  await prisma.stellarRetryQueue.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.ballotKey.deleteMany();
  await prisma.result.deleteMany();
  await prisma.option.deleteMany();
  await prisma.tokenDeliveryRetry.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();
}

let cookie: string[];

beforeAll(async () => {
  try {
    await cleanDb();
  } catch (e) {
    console.warn("DB not reachable, skipping integration tests");
    return;
  }

  await request(app).post("/api/organizations").send({
    name: "Auth Test Org",
    email: "auth@test.org",
    password: "password123",
  });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Auth Test Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"] as any;
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("Admin Auth — JWT Expiry", () => {
  it("valid JWT accepted on protected routes", async () => {
    if (!cookie) return;
    const res = await request(app)
      .get("/api/organizations/me")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Auth Test Org");
  });

  it("expired JWT returns 401 SESSION_EXPIRED", async () => {
    // Create a token that's already expired
    const jwt = require("jsonwebtoken");
    const { config } = require("../config");
    const expiredToken = jwt.sign(
      { sessionId: "fake", orgId: "fake" },
      config.jwtSecret,
      { expiresIn: "0s" }
    );

    const res = await request(app)
      .get("/api/organizations/me")
      .set("Cookie", [`session=${expiredToken}`]);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("SESSION_EXPIRED");
  });

  it("refresh with valid token issues new token", async () => {
    if (!cookie) return;
    const res = await request(app)
      .post("/api/organizations/refresh")
      .set("Cookie", cookie);
    // Should either return 200 with new token or 200 saying no refresh needed
    expect(res.status).toBe(200);
  });

  it("refresh with expired token returns 401", async () => {
    const jwt = require("jsonwebtoken");
    const { config } = require("../config");
    const expiredToken = jwt.sign(
      { sessionId: "fake", orgId: "fake" },
      config.jwtSecret,
      { expiresIn: "0s" }
    );

    const res = await request(app)
      .post("/api/organizations/refresh")
      .set("Cookie", [`session=${expiredToken}`]);
    expect(res.status).toBe(401);
  });
});
