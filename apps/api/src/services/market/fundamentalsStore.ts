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

export async function upsertFundamentals(input: FundamentalsInput) {
  // Destructure to avoid spreading the union-typed `source` directly into
  // Prisma's create/update — tsc can't narrow spread types, so we pass
  // fields explicitly to keep the compiler happy.
  const {
    securityId, symbol, periodType, periodEndDate,
    marketCap, enterpriseValue, peRatio, pbRatio,
    bookValue, eps, roe, roce, debtToEquity,
    profitLoss, balanceSheet, cashFlow, source,
  } = input;

  const data = {
    securityId, symbol, periodType, periodEndDate,
    marketCap, enterpriseValue, peRatio, pbRatio,
    bookValue, eps, roe, roce, debtToEquity,
    profitLoss, balanceSheet, cashFlow,
    source,
    fetchedAt: new Date(),
  };

  const result = await prisma.companyFundamentals.upsert({
    where: {
      securityId_periodType_periodEndDate: { securityId, periodType, periodEndDate },
    },
    create: data,
    update: data,
  });

  await invalidateCache(`fundamentals:${securityId}:`, true);
  return result;
}

export async function getLatestFundamentals(
  securityId: string,
  periodType: FundamentalPeriodType = "QUARTERLY"
) {
  return cached(
    `fundamentals:${securityId}:${periodType}`,
    { ttlSeconds: CACHE_TTL.FUNDAMENTALS },
    () =>
      prisma.companyFundamentals.findFirst({
        where: { securityId, periodType },
        orderBy: { periodEndDate: "desc" },
      })
  );
}

export async function getFundamentalsHistory(
  securityId: string,
  periodType: FundamentalPeriodType,
  limit = 8
) {
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
  const { securityId, periodEndDate, ...rest } = input;
  return prisma.shareholdingSnapshot.upsert({
    where: { securityId_periodEndDate: { securityId, periodEndDate } },
    create: { securityId, periodEndDate, ...rest, fetchedAt: new Date() },
    update: { ...rest, fetchedAt: new Date() },
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
