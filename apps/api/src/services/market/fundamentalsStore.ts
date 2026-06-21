import { prisma } from "../../lib/prisma.js";
import { cached, CACHE_TTL, invalidateCache } from "../../lib/cache.js";
import type { FundamentalPeriodType } from "@bull50/db";

export interface FundamentalsInput {
  securityId: string;
  symbol: string;
  periodType: FundamentalPeriodType;
  periodEndDate: Date;
  marketCap?: number;
  enterpriseValue?: number;
  peRatio?: number;
  pbRatio?: number;
  bookValue?: number;
  eps?: number;
  roe?: number;
  roce?: number;
  debtToEquity?: number;
  profitLoss?: Record<string, unknown>;
  balanceSheet?: Record<string, unknown>;
  cashFlow?: Record<string, unknown>;
  source: "FINEDGE" | "MANUAL";
}

/**
 * Upserts a fundamentals record. Deliberately provider-agnostic — this is
 * the write path FinEdge will call once its endpoints are confirmed, but
 * it's equally usable for manual entry or a future alternate provider
 * without any schema or API consumer changes.
 */
export async function upsertFundamentals(input: FundamentalsInput) {
  const result = await prisma.companyFundamentals.upsert({
    where: {
      securityId_periodType_periodEndDate: {
        securityId: input.securityId,
        periodType: input.periodType,
        periodEndDate: input.periodEndDate,
      },
    },
    create: { ...input, fetchedAt: new Date() },
    update: { ...input, fetchedAt: new Date() },
  });

  await invalidateCache(`fundamentals:${input.securityId}:`, true);
  return result;
}

export async function getLatestFundamentals(securityId: string, periodType: FundamentalPeriodType = "QUARTERLY") {
  return cached(`fundamentals:${securityId}:${periodType}`, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
    prisma.companyFundamentals.findFirst({
      where: { securityId, periodType },
      orderBy: { periodEndDate: "desc" },
    })
  );
}

export async function getFundamentalsHistory(securityId: string, periodType: FundamentalPeriodType, limit = 8) {
  return prisma.companyFundamentals.findMany({
    where: { securityId, periodType },
    orderBy: { periodEndDate: "desc" },
    take: limit,
  });
}

export async function upsertShareholding(input: {
  securityId: string;
  symbol: string;
  periodEndDate: Date;
  promoterPercent?: number;
  fiiPercent?: number;
  diiPercent?: number;
  mutualFundPercent?: number;
  publicPercent?: number;
  source: "FINEDGE" | "MANUAL";
}) {
  return prisma.shareholdingSnapshot.upsert({
    where: { securityId_periodEndDate: { securityId: input.securityId, periodEndDate: input.periodEndDate } },
    create: { ...input, fetchedAt: new Date() },
    update: { ...input, fetchedAt: new Date() },
  });
}

export async function getLatestShareholding(securityId: string) {
  return cached(`shareholding:${securityId}`, { ttlSeconds: CACHE_TTL.FUNDAMENTALS }, () =>
    prisma.shareholdingSnapshot.findFirst({
      where: { securityId },
      orderBy: { periodEndDate: "desc" },
    })
  );
}
