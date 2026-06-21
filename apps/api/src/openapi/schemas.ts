import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ example: "Invalid request" }),
    details: z.unknown().optional(),
  })
  .openapi("ErrorResponse");

export const UserSchema = z
  .object({
    id: z.string().openapi({ example: "clx1a2b3c0000abcd1234efgh" }),
    email: z.string().email(),
    name: z.string().optional(),
    role: z.enum(["USER", "ADMIN", "SUPERADMIN"]),
    tier: z.enum(["FREE", "PRO", "ELITE"]),
  })
  .openapi("User");

export const AuthSuccessSchema = z
  .object({
    accessToken: z.string().openapi({ description: "JWT, 15 min expiry. Refresh token is set as an httpOnly cookie." }),
    user: UserSchema,
  })
  .openapi("AuthSuccess");

export const DhanExchangeSegmentSchema = z
  .enum(["NSE_EQ", "NSE_FNO", "NSE_CURRENCY", "BSE_EQ", "BSE_FNO", "MCX_COMM", "IDX_I"])
  .openapi("DhanExchangeSegment");

export const TopListCategorySchema = z
  .enum([
    "TOP_GAINERS",
    "TOP_LOSERS",
    "MOST_ACTIVE",
    "VOLUME_SHOCKERS",
    "BREAKOUT",
    "BREAKDOWN",
    "WEEK_52_HIGH",
    "WEEK_52_LOW",
    "GAP_UP",
    "GAP_DOWN",
    "UPPER_CIRCUIT",
    "LOWER_CIRCUIT",
  ])
  .openapi("TopListCategory", {
    description:
      "VOLUME_SHOCKERS, BREAKOUT, and BREAKDOWN are accepted by the schema but not yet computed by the top-lists engine — see Phase 3 known gaps. The other 9 categories are live.",
  });

export const BearerAuth = "bearerAuth";
