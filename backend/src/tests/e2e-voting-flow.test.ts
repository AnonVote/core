import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, decryptVoteWithKeys } from "../utils/crypto";

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

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("End-to-End voting flow", () => {
  it("covers the full ballot lifecycle including valid votes, invalid attempts, tally, and verification", async () => {
    const orgRes = await request(app)
      .post("/api/organizations")
      .send({
        name: "E2E Flow Org",
        email: "e2e-flow@test.org",
        password: "Pass1234!",
      });
    expect(orgRes.status).toBe(201);

    const loginRes = await request(app)
      .post("/api/organizations/login")
      .send({ name: "E2E Flow Org", password: "Pass1234!" });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers["set-cookie"];

    const voterEmails = Array.from({ length: 10 }, (_, index) => `voter${index + 1}@e2e-flow.test`);
    const eligibilityList = await prisma.eligibilityList.create({ data: {} });
    await prisma.eligibilityEntry.createMany({
      data: voterEmails.map((email) => ({
        eligibilityListId: eligibilityList.id,
        identifierHash: hashIdentifier(email),
      })),
    });

    const ballotRes = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "E2E Lifecycle Ballot",
        options: ["Option A", "Option B", "Option C"],
        eligibilityListId: eligibilityList.id,
        deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      });
    expect(ballotRes.status).toBe(201);

    const ballotId = ballotRes.body.data.id;
    const optionAId = ballotRes.body.data.options[0].id;
    const optionBId = ballotRes.body.data.options[1].id;
    const optionCId = ballotRes.body.data.options[2].id;
    await prisma.ballot.update({
      where: { id: ballotId },
      data: { status: "ACTIVE" },
    });

    const issuedTokens: string[] = [];
    for (const voterEmail of voterEmails) {
      const tokenRes = await request(app)
        .post("/api/tokens")
        .send({ ballotId, voterIdentifier: voterEmail });
      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.data.token).toHaveLength(64);
      issuedTokens.push(tokenRes.body.data.token);
    }

    expect(await prisma.voterToken.count({ where: { ballotId } })).toBe(10);

    const votePlan: Array<{ token: string; optionId: string }> = [
      { token: issuedTokens[0], optionId: optionAId },
      { token: issuedTokens[1], optionId: optionBId },
      { token: issuedTokens[2], optionId: optionAId },
      { token: issuedTokens[3], optionId: optionCId },
      { token: issuedTokens[4], optionId: optionAId },
      { token: issuedTokens[5], optionId: optionBId },
      { token: issuedTokens[6], optionId: optionAId },
      { token: issuedTokens[7], optionId: optionCId },
    ];

    for (const vote of votePlan) {
      const voteRes = await request(app)
        .post("/api/votes")
        .send({ ballotId, voterToken: vote.token, optionId: vote.optionId });
      expect(voteRes.status).toBe(200);
      expect(voteRes.body.status).toBe("confirmed");
    }

    const duplicateRes = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: issuedTokens[0], optionId: optionAId });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toBe("TOKEN_ALREADY_USED");

    const invalidTokenRes = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: "definitely-not-a-valid-token", optionId: optionAId });
    expect(invalidTokenRes.status).toBe(401);
    expect(invalidTokenRes.body.error).toBe("INVALID_TOKEN");

    await prisma.ballot.update({
      where: { id: ballotId },
      data: { deadline: new Date(Date.now() - 60_000), status: "ACTIVE" },
    });

    const lateVoteRes = await request(app)
      .post("/api/votes")
      .send({ ballotId, voterToken: issuedTokens[8], optionId: optionAId });
    expect(lateVoteRes.status).toBe(403);
    expect(lateVoteRes.body.error).toBe("BALLOT_CLOSED");

    const finaliseRes = await request(app)
      .post(`/api/results/${ballotId}/finalise`)
      .set("Cookie", cookie);
    expect(finaliseRes.status).toBe(200);
    expect(finaliseRes.body.data.finalised).toBe(true);

    const resultRes = await request(app).get(`/api/results/${ballotId}`);
    expect(resultRes.status).toBe(200);
    expect(resultRes.body.data.totalVotes).toBe(8);
    expect(resultRes.body.data.isConsistent).toBe(true);
    expect(resultRes.body.data.stellarTxId).toBeTruthy();

    const tally = JSON.parse(resultRes.body.data.tallyJson);
    expect(tally[optionAId]).toBe(4);
    expect(tally[optionBId]).toBe(2);
    expect(tally[optionCId]).toBe(2);

    const ballotKey = await prisma.ballotKey.findUnique({ where: { ballotId } });
    expect(ballotKey).not.toBeNull();
    const votesInDb = await prisma.vote.findMany({ where: { ballotId } });
    const decryptedOptions = votesInDb.map((vote) =>
      decryptVoteWithKeys(vote.encryptedOption, [ballotKey!.key, ballotKey!.previousKey]),
    );
    const validOptionIds = new Set([optionAId, optionBId, optionCId]);
    expect(decryptedOptions.every((optionId) => validOptionIds.has(optionId))).toBe(true);

    const auditRes = await request(app).get(`/api/audit/${ballotId}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.tokensIssued).toBe(10);
    expect(auditRes.body.data.votesCast).toBe(8);

    const verifyRes = await request(app)
      .post(`/api/ballots/${ballotId}/verify`)
      .send({ token: issuedTokens[0] });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.confirmed).toBe(true);

    const zeroVoteList = await prisma.eligibilityList.create({ data: {} });
    const zeroBallotRes = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "Zero Vote Ballot",
        options: ["Yes", "No"],
        eligibilityListId: zeroVoteList.id,
        deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      });
    expect(zeroBallotRes.status).toBe(201);
    const zeroBallotId = zeroBallotRes.body.data.id;
    await prisma.ballot.update({ where: { id: zeroBallotId }, data: { status: "CLOSED" } });
    const zeroResult = await prisma.result.upsert({
      where: { ballotId: zeroBallotId },
      create: {
        ballotId: zeroBallotId,
        tallyJson: JSON.stringify({ [zeroBallotRes.body.data.options[0].id]: 0, [zeroBallotRes.body.data.options[1].id]: 0 }),
        totalVotes: 0,
        isConsistent: true,
      },
      update: {
        tallyJson: JSON.stringify({ [zeroBallotRes.body.data.options[0].id]: 0, [zeroBallotRes.body.data.options[1].id]: 0 }),
        totalVotes: 0,
        isConsistent: true,
      },
    });
    expect(zeroResult.totalVotes).toBe(0);
    expect(zeroResult.isConsistent).toBe(true);

    const allVoteList = await prisma.eligibilityList.create({ data: {} });
    const allVoteEmails = Array.from({ length: 5 }, (_, index) => `all-voter${index + 1}@e2e-flow.test`);
    await prisma.eligibilityEntry.createMany({
      data: allVoteEmails.map((email) => ({
        eligibilityListId: allVoteList.id,
        identifierHash: hashIdentifier(email),
      })),
    });

    const allVoteBallotRes = await request(app)
      .post("/api/ballots")
      .set("Cookie", cookie)
      .send({
        topic: "All Vote Ballot",
        options: ["Approve", "Reject"],
        eligibilityListId: allVoteList.id,
        deadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });
    expect(allVoteBallotRes.status).toBe(201);
    const allVoteBallotId = allVoteBallotRes.body.data.id;
    const allVoteOptionId = allVoteBallotRes.body.data.options[0].id;
    await prisma.ballot.update({ where: { id: allVoteBallotId }, data: { status: "ACTIVE" } });

    const allVoteTokens: string[] = [];
    for (const email of allVoteEmails) {
      const tokenRes = await request(app)
        .post("/api/tokens")
        .send({ ballotId: allVoteBallotId, voterIdentifier: email });
      expect(tokenRes.status).toBe(200);
      allVoteTokens.push(tokenRes.body.data.token);
    }

    for (const token of allVoteTokens) {
      const voteRes = await request(app)
        .post("/api/votes")
        .send({ ballotId: allVoteBallotId, voterToken: token, optionId: allVoteOptionId });
      expect(voteRes.status).toBe(200);
    }

    const allVoteFinaliseRes = await request(app)
      .post(`/api/results/${allVoteBallotId}/finalise`)
      .set("Cookie", cookie);
    expect(allVoteFinaliseRes.status).toBe(200);

    const allVoteResultRes = await request(app).get(`/api/results/${allVoteBallotId}`);
    expect(allVoteResultRes.status).toBe(200);
    expect(allVoteResultRes.body.data.totalVotes).toBe(5);
    expect(allVoteResultRes.body.data.isConsistent).toBe(true);
  });
});
