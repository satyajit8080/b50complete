import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import type { Role } from "@bull50/db";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  // env.JWT_ACCESS_EXPIRY is a validated config string (e.g. "15m") — newer
  // @types/jsonwebtoken wants its branded StringValue type, which a plain
  // `string` doesn't satisfy even though the runtime accepts it fine.
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings (not JWTs) stored hashed in DB.
 * This lets us revoke individual sessions and detect reuse (token theft).
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  const days = env.JWT_REFRESH_EXPIRY_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
