import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";

const ADMIN_KEY_1 = "GBRPYHAKBDZEDB6G3TTV5RFLIZSFU6L66V4H76PXD2BA42C67S5ACFF4";
const ADMIN_KEY_2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHGSYX43W2ZQC7BAECBQ2W2EF";
const INVALID_KEY = "INVALID_STELLAR_PUBLIC_KEY";

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
  await prisma.organizationKey.deleteMany();
  await prisma.organization.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("POST /api/admin/rotate-key — Admin key rotation API", () => {
  async function createAdminSession() {
    const regRes = await request(app).post("/api/organizations").send({
      name: "Admin Org",
      email: "admin@rotatekey.org",
      password: "password123",
    });
    const loginRes = await request(app).post("/api/organizations/login").send({
      name: "Admin Org",
      password: "password123",
    });
    const cookie = loginRes.headers["set-cookie"];
    return { regRes, loginRes, cookie };
  }

  it("rejects unauthorized calls with 401 when no session cookie is provided", async () => {
    const res = await request(app).post("/api/admin/rotate-key").send({
      newAdminPublicKey: ADMIN_KEY_2,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("rejects missing newAdminPublicKey with 400 Bad Request", async () => {
    const { cookie } = await createAdminSession();
    const res = await request(app)
      .post("/api/admin/rotate-key")
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/newAdminPublicKey is required/i);
  });

  it("rejects invalid key format with 400 Bad Request", async () => {
    const { cookie } = await createAdminSession();
    const res = await request(app)
      .post("/api/admin/rotate-key")
      .set("Cookie", cookie)
      .send({
        currentAdminPublicKey: ADMIN_KEY_1,
        newAdminPublicKey: INVALID_KEY,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/INVALID_KEY/i);
  });

  it("rejects rotating to the same key with 400 Bad Request", async () => {
    const { cookie } = await createAdminSession();
    const res = await request(app)
      .post("/api/admin/rotate-key")
      .set("Cookie", cookie)
      .send({
        currentAdminPublicKey: ADMIN_KEY_1,
        newAdminPublicKey: ADMIN_KEY_1,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/same as the current key/i);
  });

  it("allows admin to rotate key successfully and returns 200", async () => {
    const { cookie } = await createAdminSession();
    const res = await request(app)
      .post("/api/admin/rotate-key")
      .set("Cookie", cookie)
      .send({
        currentAdminPublicKey: ADMIN_KEY_1,
        newAdminPublicKey: ADMIN_KEY_2,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe("Admin key rotated successfully");
    expect(res.body.data.newAdminKeyMasked).toBe("GCEZ...W2EF");
  });
});
