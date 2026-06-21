import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} from "../utils/tokens.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_COOKIE = "bull50_rt";
const isProdCookie = process.env.NODE_ENV === "production";

function setRefreshCookie(res: import("express").Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProdCookie,
    sameSite: "lax",
    expires,
    path: "/api/auth",
  });
}

async function issueSession(
  res: import("express").Response,
  user: { id: string; email: string; role: import("@bull50/db").Role },
  meta: { userAgent?: string; ipAddress?: string }
) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId: user.id,
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  setRefreshCookie(res, refreshToken, expiresAt);
  return accessToken;
}

authRouter.post("/register", authLimiter, asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: "USER_REGISTERED", ipAddress: req.ip },
  });

  const accessToken = await issueSession(res, user, { userAgent: req.headers["user-agent"], ipAddress: req.ip });

  logger.info({ userId: user.id }, "User registered");
  res.status(201).json({
    accessToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tier: user.tier },
  });
}));

authRouter.post("/login", authLimiter, asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await prisma.auditLog.create({
      data: { userId: user.id, action: "LOGIN_FAILED", ipAddress: req.ip },
    });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN_SUCCESS", ipAddress: req.ip } });

  const accessToken = await issueSession(res, user, { userAgent: req.headers["user-agent"], ipAddress: req.ip });

  res.json({
    accessToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tier: user.tier },
  });
}));

authRouter.post("/refresh", asyncRoute(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: "No refresh token provided" });

  const hashed = hashToken(token);
  const stored = await prisma.refreshToken.findUnique({ where: { token: hashed }, include: { user: true } });

  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    // Possible token reuse/theft — revoke all sessions for this user if we can identify them
    if (stored) {
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId }, data: { revoked: true } });
      logger.warn({ userId: stored.userId }, "Refresh token reuse detected — all sessions revoked");
    }
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    return res.status(401).json({ error: "Session expired, please log in again" });
  }

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const accessToken = await issueSession(res, stored.user, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  res.json({ accessToken });
}));

authRouter.post("/logout", requireAuth, asyncRoute(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await prisma.refreshToken.updateMany({ where: { token: hashToken(token) }, data: { revoked: true } });
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  await prisma.auditLog.create({ data: { userId: req.user!.sub, action: "LOGOUT", ipAddress: req.ip } });
  res.status(204).send();
}));

authRouter.get("/me", requireAuth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, name: true, role: true, tier: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
}));
