import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import {
  encryptVote,
  generateToken,
  hashToken,
  hashIdentifier,
} from "../utils/crypto";
import { tallyBallot } from "../services/resultEngine";

let cookie: string;
let ballotId: string;
let optionYesId: string;
let optionNoId: string;
let originalKey: string;

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
  await prisma.organization.deleteMany();
}

beforeEach(async () => {
  await cleanDb();

  await request(app).post("/api/organizations").send({
    name: "Rotate Key Org",
    email: "rotate@example.com",
    password: "password123",
  });
  const loginRes = await request(app)
    .post("/api/organizations/login")
    .send({ name: "Rotate Key Org", password: "password123" });
  cookie = loginRes.headers["set-cookie"];

  const list = await prisma.eligibilityList.create({ data: {} });
  await prisma.eligibilityEntry.create({
    data: {
      eligibilityListId: list.id,
      identifierHash: hashIdentifier("rotate-voter-a@example.com"),
    },
  });
  await prisma.eligibilityEntry.create({
    data: {
      eligibilityListId: list.id,
      identifierHash: hashIdentifier("rotate-voter-b@example.com"),
    },
  });

  const ballotRes = await request(app)
    .post("/api/ballots")
    .set("Cookie", cookie)
    .send({
      topic: "Rotate Key Ballot",
      options: ["Yes", "No"],
      eligibilityListId: list.id,
      deadline: new Date(Date.now() + 7_200_000).toISOString(),
    });

  ballotId = ballotRes.body.data.id;
  optionYesId = ballotRes.body.data.options[0].id;
  optionNoId = ballotRes.body.data.options[1].id;

  const keyRecord = await prisma.ballotKey.findUnique({
    where: { ballotId },
  });
  originalKey = keyRecord!.key;
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("Ballot encryption key rotation", () => {
  it("rotates the stored key and keeps old votes decryptable", async () => {
    const oldToken = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(oldToken), ballotId, used: true },
    });
    await prisma.vote.create({
      data: {
        ballotId,
        encryptedOption: encryptVote(optionYesId, originalKey),
        weight: 1,
      },
    });

    const rotateRes = await request(app)
      .post(`/api/admin/ballots/${ballotId}/rotate-key`)
      .set("Cookie", cookie);

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.data.ballotId).toBe(ballotId);
    expect(rotateRes.body.data.rotatedAt).toBeTruthy();

    const rotatedRecord = await prisma.ballotKey.findUnique({
      where: { ballotId },
    });
    expect(rotatedRecord?.key).not.toBe(originalKey);
    expect(rotatedRecord?.previousKey).toBe(originalKey);
    expect(rotatedRecord?.rotatedAt).toBeTruthy();

    const newToken = generateToken();
    await prisma.voterToken.create({
      data: { tokenHash: hashToken(newToken), ballotId, used: true },
    });
    await prisma.vote.create({
      data: {
        ballotId,
        encryptedOption: encryptVote(optionNoId, rotatedRecord!.key),
        weight: 1,
      },
    });

    const result = await tallyBallot(ballotId, { skipSoroban: true });
    const tally = JSON.parse(result.tallyJson);

    expect(result.totalVotes).toBe(2);
    expect(result.isConsistent).toBe(true);
    expect(tally[optionYesId]).toBe(1);
    expect(tally[optionNoId]).toBe(1);
  });
});
