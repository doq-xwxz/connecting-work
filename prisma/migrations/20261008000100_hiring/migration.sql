-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'VIEWED', 'SHORTLISTED', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "shortlistedAt" TIMESTAMP(3),
    "offeredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "terms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "acceptedOfferId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACCEPTED',
    "terms" JSONB NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completionRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancellationCategory" TEXT,
    "cancellationReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_workerProfileId_id_idx" ON "Application"("workerProfileId", "id");

-- CreateIndex
CREATE INDEX "Application_jobId_status_id_idx" ON "Application"("jobId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_workerProfileId_key" ON "Application"("jobId", "workerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_id_jobId_key" ON "Application"("id", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_id_jobId_workerProfileId_key" ON "Application"("id", "jobId", "workerProfileId");

-- CreateIndex
CREATE INDEX "Offer_status_expiresAt_idx" ON "Offer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_creationKey_key" ON "Offer"("applicationId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_revision_key" ON "Offer"("applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_id_applicationId_jobId_key" ON "Offer"("id", "applicationId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_applicationId_key" ON "Engagement"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_acceptedOfferId_key" ON "Engagement"("acceptedOfferId");

-- CreateIndex
CREATE INDEX "Engagement_jobId_status_idx" ON "Engagement"("jobId", "status");

-- CreateIndex
CREATE INDEX "Engagement_workerProfileId_status_id_idx" ON "Engagement"("workerProfileId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_applicationId_jobId_workerProfileId_key" ON "Engagement"("applicationId", "jobId", "workerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_acceptedOfferId_applicationId_jobId_key" ON "Engagement"("acceptedOfferId", "applicationId", "jobId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_jobId_fkey" FOREIGN KEY ("applicationId", "jobId") REFERENCES "Application"("id", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_applicationId_jobId_workerProfileId_fkey" FOREIGN KEY ("applicationId", "jobId", "workerProfileId") REFERENCES "Application"("id", "jobId", "workerProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_acceptedOfferId_applicationId_jobId_fkey" FOREIGN KEY ("acceptedOfferId", "applicationId", "jobId") REFERENCES "Offer"("id", "applicationId", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Phase 5 database invariants beyond Prisma's representable schema.
-- The index/guards below are appended after table creation.
CREATE UNIQUE INDEX "Offer_one_pending_per_application" ON "Offer" ("applicationId") WHERE "status" = 'PENDING';
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_revision_expiry" CHECK ("revision" > 0 AND ("expiresAt" IS NULL OR "expiresAt" > "createdAt"));
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_resolution" CHECK (("status" = 'PENDING') = ("resolvedAt" IS NULL));
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_snapshot_version" CHECK (COALESCE(jsonb_typeof("terms") = 'object' AND "terms"->>'schemaVersion' = '1', false));
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_snapshot_version" CHECK (COALESCE(jsonb_typeof("terms") = 'object' AND "terms"->>'schemaVersion' = '1', false));
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_lifecycle" CHECK (
  ("status" <> 'IN_PROGRESS' OR "startedAt" IS NOT NULL) AND
  ("completionRequestedAt" IS NULL OR "startedAt" IS NOT NULL) AND
  ("status" <> 'COMPLETED' OR ("startedAt" IS NOT NULL AND "completionRequestedAt" IS NOT NULL AND "completedAt" IS NOT NULL)) AND
  ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancellationCategory" IS NOT NULL AND "cancellationReason" IS NOT NULL AND "cancellationCategory" IN ('PERSONAL','SCHEDULE','TERMS','OTHER') AND length("cancellationReason") BETWEEN 1 AND 500)));

CREATE FUNCTION "guard_offer_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."applicationId", NEW."jobId", NEW."creationKey", NEW."revision", NEW."terms", NEW."createdAt", NEW."expiresAt")
     IS DISTINCT FROM ROW(OLD."id", OLD."applicationId", OLD."jobId", OLD."creationKey", OLD."revision", OLD."terms", OLD."createdAt", OLD."expiresAt")
     OR (OLD."status" <> 'PENDING' AND ROW(NEW."status", NEW."resolvedAt") IS DISTINCT FROM ROW(OLD."status", OLD."resolvedAt")) THEN
    RAISE EXCEPTION 'Immutable offer history' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Offer_immutable_history" BEFORE UPDATE ON "Offer" FOR EACH ROW EXECUTE FUNCTION "guard_offer_history"();

CREATE FUNCTION "guard_engagement_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACCEPTED' OR NOT EXISTS (
      SELECT 1 FROM "Offer" o JOIN "Application" a ON a."id" = o."applicationId"
      WHERE o."id" = NEW."acceptedOfferId" AND o."status" = 'ACCEPTED' AND a."status" = 'ACCEPTED'
        AND NEW."terms"->'offer' = o."terms"
    ) THEN RAISE EXCEPTION 'Engagement requires accepted immutable offer' USING ERRCODE = '23514'; END IF;
  ELSE
    IF ROW(NEW."id", NEW."applicationId", NEW."acceptedOfferId", NEW."jobId", NEW."workerProfileId", NEW."terms", NEW."acceptedAt")
       IS DISTINCT FROM ROW(OLD."id", OLD."applicationId", OLD."acceptedOfferId", OLD."jobId", OLD."workerProfileId", OLD."terms", OLD."acceptedAt")
       OR (OLD."status" IN ('COMPLETED','CANCELLED') AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Immutable engagement history' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Engagement_immutable_history" BEFORE INSERT OR UPDATE ON "Engagement" FOR EACH ROW EXECUTE FUNCTION "guard_engagement_history"();
