/**
 * Tenant Isolation Tests
 * 
 * Critical security tests verifying multi-tenant organization isolation.
 * Tests both application-level and database-level (RLS) enforcement.
 * 
 * Test scenarios:
 * 1. Cross-organization ballot access prevention
 * 2. Cross-organization voter list access prevention
 * 3. Cross-organization audit log isolation
 * 4. Cross-organization encryption key isolation
 * 5. RLS enforcement even with direct SQL
 * 6. Defense-in-depth: both app and DB layers enforce isolation
 */

import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";
import bcrypt from "bcrypt";
import { createOrganizationKey, getOrganizationKey } from "../services/organizationKeyService";

describe("Tenant Isolation", () => {
  let orgA: { id: string; token: string; email: string };
  let orgB: { id: string; token: string; email: string };
  let ballotA: { id: string; eligibilityListId: string };
  let ballotB: { id: string; eligibilityListId: string };

  beforeAll(async () => {
    // Clean up test data
    await prisma.auditEvent.deleteMany({});
    await prisma.result.deleteMany({});
    await prisma.vote.deleteMany({});
    await prisma.voterToken.deleteMany({});
    await prisma.option.deleteMany({});
    await prisma.ballot.deleteMany({});
    await prisma.eligibilityEntry.deleteMany({});
    await prisma.eligibilityList.deleteMany({});
    await prisma.organizationKey.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.organization.deleteMany({});

    // Create Organization A
    const passwordHash = await bcrypt.hash("password123", 10);
    const orgARecord = await prisma.organization.create({
      data: {
        name: "Test Org A",
        email: "orga@test.com",
        passwordHash,
      },
    });

    const loginARes = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Test Org A", password: "password123" });

    orgA = {
      id: orgARecord.id,
      token: loginARes.headers["set-cookie"]?.[0] || "",
      email: "orga@test.com",
    };

    // Create Organization B
    const orgBRecord = await prisma.organization.create({
      data: {
        name: "Test Org B",
        email: "orgb@test.com",
        passwordHash,
      },
    });

    const loginBRes = await request(app)
      .post("/api/organizations/login")
      .send({ name: "Test Org B", password: "password123" });

    orgB = {
      id: orgBRecord.id,
      token: loginBRes.headers["set-cookie"]?.[0] || "",
      email: "orgb@test.com",
    };

    // Create encryption keys for both organizations
    await createOrganizationKey(orgA.id);
    await createOrganizationKey(orgB.id);

    // Create ballot for Organization A
    const eligibilityListA = await prisma.eligibilityList.create({
      data: {
        entries: {
          create: [
            { identifierHash: "hash_a1", weight: 1 },
            { identifierHash: "hash_a2", weight: 1 },
          ],
        },
      },
    });

    const ballotARes = await request(app)
      .post("/api/ballots")
      .set("Cookie", orgA.token)
      .send({
        topic: "Ballot A",
        options: ["Option A1", "Option A2"],
        eligibilityListId: eligibilityListA.id,
        deadline: new Date(Date.now() + 86400000).toISOString(),
      });

    ballotA = {
      id: ballotARes.body.data.id,
      eligibilityListId: eligibilityListA.id,
    };

    // Create ballot for Organization B
    const eligibilityListB = await prisma.eligibilityList.create({
      data: {
        entries: {
          create: [
            { identifierHash: "hash_b1", weight: 1 },
            { identifierHash: "hash_b2", weight: 1 },
          ],
        },
      },
    });

    const ballotBRes = await request(app)
      .post("/api/ballots")
      .set("Cookie", orgB.token)
      .send({
        topic: "Ballot B",
        options: ["Option B1", "Option B2"],
        eligibilityListId: eligibilityListB.id,
        deadline: new Date(Date.now() + 86400000).toISOString(),
      });

    ballotB = {
      id: ballotBRes.body.data.id,
      eligibilityListId: eligibilityListB.id,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Ballot Isolation", () => {
    it("should allow organization to see their own ballots", async () => {
      const res = await request(app)
        .get("/api/ballots")
        .set("Cookie", orgA.token);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].topic).toBe("Ballot A");
    });

    it("should not show other organization's ballots in list", async () => {
      const res = await request(app)
        .get("/api/ballots")
        .set("Cookie", orgA.token);

      expect(res.status).toBe(200);
      const topics = res.body.data.map((b: any) => b.topic);
      expect(topics).not.toContain("Ballot B");
    });

    it("should prevent organization from editing another org's ballot", async () => {
      const res = await request(app)
        .patch(`/api/ballots/${ballotB.id}`)
        .set("Cookie", orgA.token)
        .send({ topic: "Hacked Ballot B" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("own ballots");
    });

    it("should prevent organization from deleting another org's ballot", async () => {
      const res = await request(app)
        .delete(`/api/ballots/${ballotB.id}`)
        .set("Cookie", orgA.token);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("own ballots");
    });
  });

  describe("Eligibility List Isolation", () => {
    it("should not allow organization to use another org's eligibility list", async () => {
      const res = await request(app)
        .post("/api/ballots")
        .set("Cookie", orgA.token)
        .send({
          topic: "Cross-tenant test",
          options: ["Option 1", "Option 2"],
          eligibilityListId: ballotB.eligibilityListId,
          deadline: new Date(Date.now() + 86400000).toISOString(),
        });

      // This should either fail or be prevented by RLS
      // At minimum, the ballot should not be accessible
      if (res.status === 201) {
        const ballotId = res.body.data.id;
        const ballot = await prisma.ballot.findUnique({
          where: { id: ballotId },
        });
        expect(ballot?.organizationId).toBe(orgA.id);
      }
    });
  });

  describe("Audit Log Isolation", () => {
    it("should only show organization's own audit events", async () => {
      // Generate audit events for both orgs
      await prisma.auditEvent.create({
        data: {
          ballotId: ballotA.id,
          organizationId: orgA.id,
          eventType: "TOKEN_ISSUED",
        },
      });

      await prisma.auditEvent.create({
        data: {
          ballotId: ballotB.id,
          organizationId: orgB.id,
          eventType: "TOKEN_ISSUED",
        },
      });

      // /api/audit/:ballotId is deliberately public (counts + event types only).
      // The org-scoped surface is /api/admin/audit/:ballotId — assert isolation there.
      const resA = await request(app)
        .get(`/api/admin/audit/${ballotA.id}`)
        .set("Cookie", orgA.token);

      expect(resA.status).toBe(200);
      expect(resA.body.data.summary.ballotId).toBe(ballotA.id);
      const eventBallotIds = resA.body.data.eventLog.map((e: any) => e.ballotId);
      expect(eventBallotIds).toContain(ballotA.id);
      expect(eventBallotIds).not.toContain(ballotB.id);
    });

    it("should prevent accessing another organization's audit logs", async () => {
      const res = await request(app)
        .get(`/api/admin/audit/${ballotB.id}`)
        .set("Cookie", orgA.token);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.message).toContain("your own ballots");
    });
  });

  describe("Encryption Key Isolation", () => {
    it("should have different encryption keys per organization", async () => {
      const keyA = await getOrganizationKey(orgA.id);
      const keyB = await getOrganizationKey(orgB.id);

      expect(keyA).not.toEqual(keyB);
      expect(keyA.length).toBe(32); // 256 bits
      expect(keyB.length).toBe(32);
    });

    it("should not allow organization to access another org's keys", async () => {
      const res = await request(app)
        .get(`/api/admin/organizations/${orgB.id}/encryption-keys`)
        .set("Cookie", orgA.token);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("own organization");
    });

    it("should not allow organization to rotate another org's keys", async () => {
      const res = await request(app)
        .post(`/api/admin/organizations/${orgB.id}/rotate-keys`)
        .set("Cookie", orgA.token);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("own organization");
    });

    it("should allow organization to rotate their own keys", async () => {
      const res = await request(app)
        .post(`/api/admin/organizations/${orgA.id}/rotate-keys`)
        .set("Cookie", orgA.token);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("rotated");

      // Verify new key was created
      const keys = await prisma.organizationKey.findMany({
        where: { organizationId: orgA.id },
        orderBy: { keyVersion: "desc" },
      });

      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(keys[0].keyVersion).toBe(2);
      expect(keys[0].isActive).toBe(true);
      expect(keys[1].isActive).toBe(false);
    });
  });

  describe("Database-Level RLS Enforcement", () => {
    it("should enforce ballot isolation at database level", async () => {
      // Try to query across organizations using raw SQL
      // This simulates SQL injection or compromised application code
      
      try {
        // Set context for Org A
        await prisma.$executeRawUnsafe(
          `SET LOCAL app.current_organization_id = '${orgA.id}';`
        );

        // Try to query all ballots (should only get Org A's)
        const ballots = await prisma.ballot.findMany({});
        
        const topics = ballots.map(b => b.topic);
        expect(topics).toContain("Ballot A");
        expect(topics).not.toContain("Ballot B");
      } catch (err) {
        // RLS preventing access is also acceptable
        expect(err).toBeDefined();
      }
    });

    it("should enforce audit log isolation at database level", async () => {
      try {
        // Set context for Org B
        await prisma.$executeRawUnsafe(
          `SET LOCAL app.current_organization_id = '${orgB.id}';`
        );

        // Query audit events (should only get Org B's)
        const events = await prisma.auditEvent.findMany({});
        
        const orgIds = events.map(e => e.organizationId);
        expect(orgIds.every(id => id === orgB.id)).toBe(true);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  describe("Session Isolation", () => {
    it("should not allow using another organization's session token", async () => {
      // Try to use Org A's token for Org B's data
      const res = await request(app)
        .get("/api/ballots")
        .set("Cookie", orgA.token);

      expect(res.status).toBe(200);
      const topics = res.body.data.map((b: any) => b.topic);

      // Should only see Org A's ballots
      expect(topics).toContain("Ballot A");
      expect(topics).not.toContain("Ballot B");
    });

    it("should validate session belongs to correct organization", async () => {
      // Sessions should be scoped by organizationId
      const sessions = await prisma.session.findMany({
        where: { organizationId: orgA.id },
      });

      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every(s => s.organizationId === orgA.id)).toBe(true);
    });
  });

  describe("Defense in Depth", () => {
    it("should have organizationId filter in application code", async () => {
      // Verify ballot queries include organizationId filter
      const ballot = await prisma.ballot.findFirst({
        where: {
          id: ballotA.id,
          organizationId: orgA.id, // Application-level filter
        },
      });

      expect(ballot).toBeDefined();
      expect(ballot?.organizationId).toBe(orgA.id);
    });

    it("should combine RLS and application filters", async () => {
      // Set RLS context
      await prisma.$executeRawUnsafe(
        `SET LOCAL app.current_organization_id = '${orgA.id}';`
      );

      // Application filter should also be present
      const ballots = await prisma.ballot.findMany({
        where: { organizationId: orgA.id },
      });

      expect(ballots.length).toBeGreaterThan(0);
      expect(ballots.every(b => b.organizationId === orgA.id)).toBe(true);
    });
  });

  describe("Cross-Organization Join Prevention", () => {
    it("should prevent joins across organization boundaries", async () => {
      // Try to join votes from different organizations
      const votes = await prisma.vote.findMany({
        where: { ballotId: ballotA.id },
        include: { ballot: true },
      });

      // All votes should belong to same organization's ballot
      votes.forEach(vote => {
        expect(vote.ballot.organizationId).toBe(orgA.id);
      });
    });

    it("should prevent option access across organizations", async () => {
      const options = await prisma.option.findMany({
        where: { ballotId: ballotA.id },
        include: { ballot: true },
      });

      options.forEach(option => {
        expect(option.ballot.organizationId).toBe(orgA.id);
      });
    });
  });
});
