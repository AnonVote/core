import request from "supertest";
import app from "../app";
import { prisma } from "../prisma/client";

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();
});

afterAll(async () => {
  await prisma.session.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.$disconnect();
});

describe("POST /api/organizations — Registration", () => {
  it("creates an organization and returns 201", async () => {
    const res = await request(app).post("/api/organizations").send({
      name: "Test Org",
      email: "admin@test.org",
      password: "password123",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Test Org");
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  it("returns 400 for duplicate organization name", async () => {
    await request(app)
      .post("/api/organizations")
      .send({ name: "Dup Org", email: "a@b.com", password: "pass1234" });
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Dup Org", email: "c@d.com", password: "pass1234" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already taken/i);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Incomplete" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing/i);
  });
});

describe("POST /api/organizations/login", () => {
  beforeEach(async () => {
    await request(app).post("/api/organizations").send({
      name: "Login Org",
      email: "login@test.org",
      password: "correctpassword",
    });
  });

  it("returns 200 and sets session cookie on valid credentials", async () => {
    const res = await request(app).post("/api/organizations/login").send({
      name: "Login Org",
      password: "correctpassword",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Login Org");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app).post("/api/organizations/login").send({
      name: "Login Org",
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("returns 401 on unknown org name", async () => {
    const res = await request(app).post("/api/organizations/login").send({
      name: "Unknown Org",
      password: "anypassword",
    });
    expect(res.status).toBe(401);
  });
});
