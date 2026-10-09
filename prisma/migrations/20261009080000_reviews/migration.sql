CREATE TYPE "ReviewDirection" AS ENUM ('WORKER_TO_EMPLOYER', 'EMPLOYER_TO_WORKER');
CREATE TABLE "Review" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "engagementId" TEXT NOT NULL REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "direction" "ReviewDirection" NOT NULL,
  "reviewerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "workerProfileId" TEXT NOT NULL REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employerProfileId" TEXT REFERENCES "EmployerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "companyId" TEXT REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment" TEXT CHECK ("comment" IS NULL OR length(btrim("comment")) BETWEEN 1 AND 2000),
  "creationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hiddenAt" TIMESTAMP(3),
  CONSTRAINT "Review_one_owner" CHECK (("companyId" IS NULL) <> ("employerProfileId" IS NULL))
);
CREATE UNIQUE INDEX "Review_engagementId_direction_key" ON "Review"("engagementId", "direction");
CREATE INDEX "Review_workerProfileId_direction_hiddenAt_createdAt_id_idx" ON "Review"("workerProfileId", "direction", "hiddenAt", "createdAt", "id");
CREATE INDEX "Review_employerProfileId_direction_hiddenAt_createdAt_id_idx" ON "Review"("employerProfileId", "direction", "hiddenAt", "createdAt", "id");
CREATE INDEX "Review_companyId_direction_hiddenAt_createdAt_id_idx" ON "Review"("companyId", "direction", "hiddenAt", "createdAt", "id");
CREATE INDEX "Review_reviewerUserId_idx" ON "Review"("reviewerUserId");
-- Separates personal owner history from Company creator provenance.
CREATE INDEX "Engagement_personal_history" ON "Job"("employerProfileId", "id") WHERE "companyId" IS NULL;
CREATE FUNCTION "guard_review_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Phase 9 must evolve this trigger in a reviewed migration for hide-only actions.
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Immutable review history' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NEW."hiddenAt" IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM "Engagement" e JOIN "Job" j ON j."id" = e."jobId"
      JOIN "WorkerProfile" w ON w."id" = e."workerProfileId"
      JOIN "User" u ON u."id" = NEW."reviewerUserId"
      WHERE e."id" = NEW."engagementId" AND e."status" = 'COMPLETED'
        AND e."workerProfileId" = NEW."workerProfileId"
        AND j."companyId" IS NOT DISTINCT FROM NEW."companyId"
        AND (j."companyId" IS NOT NULL OR j."employerProfileId" = NEW."employerProfileId")
        AND u."status" = 'ACTIVE'
        AND ((NEW."direction" = 'WORKER_TO_EMPLOYER' AND w."userId" = u."id"
          AND EXISTS (SELECT 1 FROM "UserRole" r WHERE r."userId" = u."id" AND r."role" = 'WORKER'))
        OR (NEW."direction" = 'EMPLOYER_TO_WORKER'
          AND EXISTS (SELECT 1 FROM "UserRole" r WHERE r."userId" = u."id" AND r."role" = 'EMPLOYER')
          AND ((j."companyId" IS NULL AND EXISTS (SELECT 1 FROM "EmployerProfile" p WHERE p."id" = j."employerProfileId" AND p."userId" = u."id"))
            OR EXISTS (SELECT 1 FROM "CompanyMember" m WHERE m."companyId" = j."companyId" AND m."userId" = u."id" AND m."role" IN ('OWNER','MANAGER')))))
    ) THEN RAISE EXCEPTION 'Review requires completed work and current participant' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Review_immutable_history" BEFORE INSERT OR UPDATE ON "Review" FOR EACH ROW EXECUTE FUNCTION "guard_review_history"();
-- No application edit/delete endpoints. RESTRICT preserves referenced history.
-- Trusted fixture/retention operators can delete; D7 remains deferred.
