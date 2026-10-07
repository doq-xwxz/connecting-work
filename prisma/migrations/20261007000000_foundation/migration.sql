-- Infrastructure-only probe. No marketplace domain schema.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "FoundationCheck" (
    "id" SERIAL NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FoundationCheck_pkey" PRIMARY KEY ("id")
);
