import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/client";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { badRequest, unauthorized } from "../utils/errors";

const router = Router();

// POST /api/organizations — Register a new organization
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      const missing = ["name", "email", "password"].filter((f) => !req.body[f]);
      throw badRequest(`Missing required fields: ${missing.join(", ")}`);
    }

    const existing = await prisma.organization.findUnique({ where: { name } });
    if (existing) {
      throw badRequest(`Organization name "${name}" is already taken`);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const org = await prisma.organization.create({
      data: { name, email, passwordHash },
    });

    res.status(201).json({
      data: {
        id: org.id,
        name: org.name,
        email: org.email,
        createdAt: org.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/organizations/login — Admin login
router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, password } = req.body;

      if (!name || !password) {
        throw unauthorized("Invalid credentials");
      }

      const org = await prisma.organization.findUnique({ where: { name } });
      if (!org) {
        throw unauthorized("Invalid credentials");
      }

      const valid = await bcrypt.compare(password, org.passwordHash);
      if (!valid) {
        throw unauthorized("Invalid credentials");
      }

      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

      const session = await prisma.session.create({
        data: {
          organizationId: org.id,
          token: "", // placeholder, updated below
          expiresAt,
        },
      });

      const token = jwt.sign(
        { sessionId: session.id, orgId: org.id },
        config.jwtSecret,
        {
          expiresIn: "8h",
        },
      );

      // Update session with the actual JWT
      await prisma.session.update({
        where: { id: session.id },
        data: { token },
      });

      res.cookie("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.nodeEnv === "production",
        maxAge: 8 * 60 * 60 * 1000,
      });

      res
        .status(200)
        .json({ data: { organizationId: org.id, name: org.name } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/organizations/logout — Admin logout
router.post(
  "/logout",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies?.session;
      if (token) {
        await prisma.session.deleteMany({ where: { token } });
      }
      res.clearCookie("session");
      res.status(200).json({ data: { message: "Logged out successfully" } });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/organizations/me — Get current org (used by frontend auth check)
router.get("/me", requireAuth, (req: Request, res: Response) => {
  const org = req.organization!;
  res
    .status(200)
    .json({ data: { id: org.id, name: org.name, email: org.email } });
});

export default router;
