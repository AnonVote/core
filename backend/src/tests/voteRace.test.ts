import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import { hashIdentifier, generateToken, hashToken } from "../utils/crypto";
import * as sorobanService from "../services/sorobanService";

describe("Vote Race Condition Test (backend/src/tests/voteRace.test.ts)", () => {
  beforeAll(async () => {
    jest.spyOn(sorobanService, "sorobanRecordVote").mockResolvedValue("0xrace_tx_hash");

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
    await prisma.organizationKey.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
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
    await prisma.organizationKey.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.$disconnect();
  });

  it("prevents double voting across 10 consecutive concurrent runs", async () => {
    for (let run = 1; run <= 10; run++) {
      const org = await prisma.organization.create({
        data: {
          name: `Race Org ${run}_${Date.now()}`,
          email: `race${run}_${Date.now()}@test.com`,
          passwordHash: "hash123",
        },
      });

      const list = await prisma.eligibilityList.create({ data: {} });
      await prisma.eligibilityEntry.create({
        data: {
          eligibilityListId: list.id,
          identifierHash: hashIdentifier(`voter${run}_${Date.now()}@test.com`),
        },
      });

      const ballot = await prisma.ballot.create({
        data: {
          organizationId: org.id,
          topic: `Race Ballot ${run}`,
          eligibilityListId: list.id,
          deadline: new Date(Date.now() + 3600_000),
          status: "ACTIVE",
          options: {
            create: [{ text: "Option A" }, { text: "Option B" }],
          },
        },
        include: { options: true },
      });

      const ballotId = ballot.id;
      const optionId = (ballot as any).options[0].id;

      const raceToken = generateToken();
      await prisma.voterToken.create({
        data: {
          tokenHash: hashToken(raceToken),
          ballotId,
        },
      });

      // Fire two concurrent requests with identical token using Promise.all
      const [res1, res2] = await Promise.all([
        request(app)
          .post("/api/votes")
          .send({ ballot_id: ballotId, token: raceToken, option_id: optionId }),
        request(app)
          .post("/api/votes")
          .send({ ballot_id: ballotId, token: raceToken, option_id: optionId }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      const errorCodes = [res1.body?.error, res2.body?.error].filter(Boolean);

      // Assert exactly one 200/201 success and one 409 error
      expect(statuses).toEqual([200, 409]);
      expect(errorCodes).toContain("TOKEN_ALREADY_USED");

      // Assert exactly one row in votes table for the ballot
      const voteCount = await prisma.vote.count({ where: { ballotId } });
      expect(voteCount).toBe(1);

      // Assert token is marked used exactly once in eligibility table
      const tokenRecord = await prisma.voterToken.findUnique({
        where: { tokenHash: hashToken(raceToken) },
      });
      expect(tokenRecord?.used).toBe(true);
      expect(tokenRecord?.usedAt).not.toBeNull();
    }
  }, 60000);
});
