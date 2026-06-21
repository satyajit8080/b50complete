import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ErrorResponseSchema, AuthSuccessSchema, UserSchema, BearerAuth } from "./schemas.js";

export function registerAuthPaths(registry: OpenAPIRegistry) {
  registry.registerComponent("securitySchemes", BearerAuth, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Access token from /api/auth/login, /register, or /refresh. 15 min expiry.",
  });

  const RegisterRequestSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1).max(100).optional(),
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/register",
    tags: ["Auth"],
    summary: "Create a new account",
    description: "Rate limited to 10 requests/min per IP. Sets a refresh token as an httpOnly cookie.",
    request: { body: { content: { "application/json": { schema: RegisterRequestSchema } } } },
    responses: {
      201: { description: "Account created", content: { "application/json": { schema: AuthSuccessSchema } } },
      400: { description: "Validation failed", content: { "application/json": { schema: ErrorResponseSchema } } },
      409: { description: "Email already registered", content: { "application/json": { schema: ErrorResponseSchema } } },
      429: { description: "Rate limited", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  const LoginRequestSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/login",
    tags: ["Auth"],
    summary: "Log in",
    description: "Rate limited to 10 requests/min per IP.",
    request: { body: { content: { "application/json": { schema: LoginRequestSchema } } } },
    responses: {
      200: { description: "Login successful", content: { "application/json": { schema: AuthSuccessSchema } } },
      400: { description: "Validation failed", content: { "application/json": { schema: ErrorResponseSchema } } },
      401: { description: "Invalid credentials", content: { "application/json": { schema: ErrorResponseSchema } } },
      429: { description: "Rate limited", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/refresh",
    tags: ["Auth"],
    summary: "Rotate refresh token and issue a new access token",
    description:
      "Reads the bull50_rt httpOnly cookie. Rotates the refresh token on every call. If a revoked/expired token is reused, ALL sessions for that user are revoked (theft detection).",
    responses: {
      200: {
        description: "New access token issued",
        content: { "application/json": { schema: z.object({ accessToken: z.string() }) } },
      },
      401: { description: "No/invalid/expired refresh token", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/logout",
    tags: ["Auth"],
    summary: "Log out and revoke the current session",
    security: [{ [BearerAuth]: [] }],
    responses: {
      204: { description: "Logged out" },
      401: { description: "Not authenticated", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/auth/me",
    tags: ["Auth"],
    summary: "Get the current authenticated user",
    security: [{ [BearerAuth]: [] }],
    responses: {
      200: { description: "Current user", content: { "application/json": { schema: z.object({ user: UserSchema }) } } },
      401: { description: "Not authenticated", content: { "application/json": { schema: ErrorResponseSchema } } },
      404: { description: "User not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    },
  });
}
