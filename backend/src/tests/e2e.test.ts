/**
 * End-to-end test: register org → create ballot → request token → submit vote → verify result
 */
import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier } from "../utils/crypto";

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.voterToken.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.result.deleteMany();
  await prisma.ballot.deleteMany();
  await prisma.eligibilityEntry.deleteMany();
  await prisma.eligibilityList.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.$disconnect();
});

describe("End-to-End: Full voting flow", () => {
  it("completes the full voting lifecycle", async () => {
    // 1. Register organization
    const regRes = await request(app).post("/api/organizations").send({
      name: "E2E Test Org",
      email: "e2e@test.org",
      password: "e2epassword",
    });
    expect(regRes.status).toBe(201);

    // 2. Login
    const loginRes = await request(app).post("/api/organizations/login").send({
      name: "E2E Test Org",
      password: "e2epassword",
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers["set-cookie"];

    // 3. Upload eligibility list
    const voterEmail = "e2evoter@test.com";
    const list = await prisma.eligibilityList.create({ data: {} });
    await prisma.eligibilityEntry.create({
      data: {
        eligibilityListId: list.id,
        identifierHash: hashIdentifier(voterEmail),
      },
    });

    // 4. Create ballot
    const ballotRes = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "E2E Test Vote",
        options: ["Approve", "Reject"],
        eligibilityListId: list.id,
        deadline: new Date(Date.now() + 3600_000).toISOString(),
      });
    expect(ballotRes.status).toBe(201);
    const ballotId = ballotRes.body.data.id;
    const optionId = ballotRes.body.data.options[0].id;

    // 5. Request voter token
    const tokenRes = await request(app).post("/api/tokens").send({
      ballotId,
      voterIdentifier: voterEmail,
    });
    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.data.token;
    expect(token).toHaveLength(64);

    // 6. Submit vote
    const voteRes = await request(app).post("/api/votes").send({
      ballotId,
      voterToken: token,
      optionId,
    });
    expect(voteRes.status).toBe(201);
    expect(voteRes.body.data.voteId).toBeDefined();

    // 7. Close ballot and tally manually
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "CLOSED" },
    });
    const { tallyBallot } = await import("../services/resultEngine");
    await tallyBallot(ballotId);

    // 8. Verify result
    const resultRes = await request(app).get(`/api/results/${ballotId}`);
    expect(resultRes.status).toBe(200);
    expect(resultRes.body.data.totalVotes).toBe(1);
    expect(resultRes.body.data.isConsistent).toBe(true);

    const tally = JSON.parse(resultRes.body.data.tallyJson);
    expect(tally[optionId]).toBe(1);

    // 9. Verify audit counts
    const auditRes = await request(app).get(`/api/audit/${ballotId}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.tokensIssued).toBe(1);
    expect(auditRes.body.data.votesCast).toBe(1);
  });
});
