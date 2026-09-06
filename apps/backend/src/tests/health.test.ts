import request from "supertest";
import app from "../app";

jest.mock("../prisma/client", () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import { prisma } from "../prisma/client";
const mockedPrisma = prisma as unknown as { $queryRaw: jest.Mock };

describe("GET /api/health", () => {
  beforeEach(() => {
    mockedPrisma.$queryRaw.mockReset();
  });

  it("returns 200 with ok status when the database is reachable", async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("ok");
    expect(res.body.checks.database.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
    expect(res.body.checks.database.responseTime).toMatch(/^\d+ms$/);
  });

  it("returns 503 with error status when the database is unreachable", async () => {
    mockedPrisma.$queryRaw.mockRejectedValueOnce(new Error("Connection timeout"));

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.database).toBe("error");
    expect(res.body.checks.database.status).toBe("error");
    expect(res.body.checks.database.error).toBe("Connection timeout");
    expect(res.body.checks.database.responseTime).toMatch(/^\d+ms$/);
  });

  it("does not require authentication", async () => {
    mockedPrisma.$queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
  });
});
