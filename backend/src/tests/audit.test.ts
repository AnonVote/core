import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";

let ballotId: string;

beforeAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();

  await request(app)
    .post("/api/organizations")
    .send({
      name: "Audit Test Org",
      email: "audit@b.com",
      password: "pass1234",
    });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Audit Test Org", password: "pass1234" });
  const cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Audit Ballot",
      options: ["Yes", "No"],
      eligibilityListId: list.id,
      deadline: new Date(Date.now() + 3600_000).toISOString(),
    });
  ballotId = ballotRes.body.data.id;

  // Seed some audit events
  await prisma.auditEvent.createMany({
    data: [
      { ballotId, eventType: "TOKEN_ISSUED" },
      { ballotId, eventType: "TOKEN_ISSUED" },
      { ballotId, eventType: "VOTE_CAST" },
    ],
  });
});

afterAll(() => prisma.$disconnect());

describe("GET /api/audit/:ballotId", () => {
  it("returns correct event counts for a known ballot", async () => {
    const res = await request(app).get(`/api/audit/${ballotId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tokensIssued).toBe(2);
    expect(res.body.data.votesCast).toBe(1);
    expect(Array.isArray(res.body.data.events)).toBe(true);
  });

  it("returns zero counts for unknown ballot", async () => {
    const res = await request(app).get("/api/audit/non-existent-ballot-id");
    expect(res.status).toBe(200);
    expect(res.body.data.tokensIssued).toBe(0);
    expect(res.body.data.votesCast).toBe(0);
  });
});
