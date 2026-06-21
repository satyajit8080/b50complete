import type { Request, Response, NextFunction } from "express";
import { RateLimiterRedis } from "rate-limiter-flexible";
import { redis } from "../lib/redis.js";

function makeLimiter(points: number, durationSeconds: number, keyPrefix: string) {
  const limiter = new RateLimiterRedis({ storeClient: redis, points, duration: durationSeconds, keyPrefix });

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.user?.sub ?? req.ip ?? "anon";
    try {
      await limiter.consume(key);
      next();
    } catch {
      res.status(429).json({ error: "Too many requests, please slow down" });
    }
  };
}

// General API traffic: 100 req / 60s per IP or user
export const apiLimiter = makeLimiter(100, 60, "rl:api");

// Auth endpoints (login/register): tighter, to slow brute force
export const authLimiter = makeLimiter(10, 60, "rl:auth");
