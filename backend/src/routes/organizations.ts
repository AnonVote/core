import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma/client";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createOrganizationSchema,
  loginOrganizationSchema,
  updateOrganizationSchema,
  changePasswordSchema,
} from "../validation/schemas";
import { badRequest, unauthorized, notFound } from "../utils/errors";
import {
  updateOrg,
  changeOrgPassword,
  deleteOrgAccount,
} from "../services/organizationService";

const router = Router();

// POST /api/organizations — Register a new organization
router.post(
  "/",
  validate(createOrganizationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, password } = req.body;

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
  },
);

// POST /api/organizations/login — Admin login
router.post(
  "/login",
  validate(loginOrganizationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, password } = req.body;

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
        sameSite: config.nodeEnv === "production" ? "none" : "strict",
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

// PATCH /api/organizations/me — Update name or email
router.patch(
  "/me",
  requireAuth,
  validate(updateOrganizationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email } = req.body;
      const updated = await updateOrg(req.organization!.id, { name, email });
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/organizations/password — Change password
router.patch(
  "/password",
  requireAuth,
  validate(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await changeOrgPassword(
        req.organization!.id,
        currentPassword,
        newPassword,
      );
      res.status(200).json({ message: "Password updated" });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/organizations/me — Delete account
router.delete(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteOrgAccount(req.organization!.id);
      res.clearCookie("session");
      res.status(200).json({ message: "Account deleted" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
