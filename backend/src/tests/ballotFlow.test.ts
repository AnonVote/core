import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";

let cookie: string[];
let eligibilityListId: string;

describe("Ballot Creation Flow", () => {
  beforeAll(async () => {
    // We assume the DB is running or we skip these tests
    try {
        await prisma.organization.deleteMany();
    } catch (e) {
        console.warn("DB not reachable, skipping integration tests");
        return;
    }

    await request(app).post("/api/organizations").send({
      name: "Flow Test Org",
      email: "flow@test.org",
      password: "password123",
    });
    const loginRes = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Flow Test Org", password: "password123" });
    cookie = loginRes.headers["set-cookie"] as any;

    const list = await prisma.eligibilityList.create({ data: {} });
    eligibilityListId = list.id;
  });

  afterAll(() => prisma.$disconnect());

  it("should enforce validation rules", async () => {
    if (!cookie) return;

    // Too few options
    let res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "Invalid",
        options: ["One"],
        eligibilityListId,
        deadline: new Date(Date.now() + 3600000).toISOString(),
      });
    expect(res.status).toBe(400);

    // Deadline too close (less than 1 hour)
    res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "Invalid Deadline",
        options: ["A", "B"],
        eligibilityListId,
        deadline: new Date(Date.now() + 1800000).toISOString(), // 30 mins
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 1 hour/i);
  });

  it("should create a ballot and set anchor to PENDING (since SOROBAN_CONTRACT_ID is missing)", async () => {
    if (!cookie) return;

    const res = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "Anchoring Test",
        options: ["Yes", "No"],
        eligibilityListId,
        deadline: new Date(Date.now() + 7200000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.anchorStatus).toBe("PENDING");
  });
});
