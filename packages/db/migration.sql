-- Phase 3: Option chain snapshots and index snapshots

CREATE TABLE "OptionChainSnapshot" (
  "id"              TEXT NOT NULL,
  "underlying"      TEXT NOT NULL,
  "underlyingScrip" INTEGER NOT NULL,
  "expiry"          TEXT NOT NULL,
  "lastPrice"       DOUBLE PRECISION NOT NULL,
  "strikes"         INTEGER NOT NULL,
  "putCallRatio"    DOUBLE PRECISION NOT NULL,
  "maxPainStrike"   DOUBLE PRECISION NOT NULL,
  "totalCallOi"     DOUBLE PRECISION NOT NULL,
  "totalPutOi"      DOUBLE PRECISION NOT NULL,
  "callOiChange"    DOUBLE PRECISION NOT NULL,
  "putOiChange"     DOUBLE PRECISION NOT NULL,
  "atmIv"           DOUBLE PRECISION,
  "rawChain"        JSONB NOT NULL,
  "snapshotAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OptionChainSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptionChainSnapshot_underlying_expiry_key"
  ON "OptionChainSnapshot"("underlying", "expiry");

CREATE INDEX "OptionChainSnapshot_underlying_snapshotAt_idx"
  ON "OptionChainSnapshot"("underlying", "snapshotAt");

CREATE TABLE "IndexSnapshot" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "securityId"    TEXT NOT NULL,
  "lastPrice"     DOUBLE PRECISION NOT NULL,
  "open"          DOUBLE PRECISION NOT NULL,
  "high"          DOUBLE PRECISION NOT NULL,
  "low"           DOUBLE PRECISION NOT NULL,
  "prevClose"     DOUBLE PRECISION NOT NULL,
  "changePercent" DOUBLE PRECISION NOT NULL,
  "snapshotAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IndexSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndexSnapshot_name_snapshotAt_key"
  ON "IndexSnapshot"("name", "snapshotAt");

CREATE INDEX "IndexSnapshot_name_snapshotAt_idx"
  ON "IndexSnapshot"("name", "snapshotAt");
