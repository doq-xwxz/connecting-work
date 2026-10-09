-- CreateEnum
CREATE TYPE "ModerationTarget" AS ENUM ('JOB', 'REVIEW', 'USER', 'MESSAGE', 'COMPANY', 'ENGAGEMENT');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'SCAM', 'HARASSMENT', 'INAPPROPRIATE_CONTENT', 'MISLEADING_JOB', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'ACTIONED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CASE_CREATED', 'CASE_INVESTIGATING', 'CASE_CLOSED', 'REPORT_ATTACHED', 'JOB_HIDDEN', 'JOB_UNHIDDEN', 'REVIEW_HIDDEN', 'REVIEW_UNHIDDEN', 'USER_SUSPENDED', 'USER_UNSUSPENDED', 'USER_BANNED', 'ENGAGEMENT_FORCE_COMPLETED', 'ENGAGEMENT_FORCE_CANCELLED', 'CASE_CONTEXT_READ');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "moderationAuditId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "moderationAuditId" TEXT,
ADD COLUMN     "moderationHiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Engagement" ADD COLUMN     "moderationAuditId" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "moderationAuditId" TEXT;

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "targetType" "ModerationTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasonCode" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "targetType" "ModerationTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "CaseSeverity" NOT NULL,
    "openedByAdminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "resolutionCode" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReport" (
    "caseId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,

    CONSTRAINT "CaseReport_pkey" PRIMARY KEY ("caseId","reportId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "resourceType" "ModerationTarget" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reasonCode" "ReportReason" NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "transactionId" TEXT NOT NULL DEFAULT pg_current_xact_id()::text,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_reporterUserId_status_id_idx" ON "Report"("reporterUserId", "status", "id");

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_status_idx" ON "Report"("targetType", "targetId", "status");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_id_idx" ON "Report"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ModerationCase_status_severity_createdAt_id_idx" ON "ModerationCase"("status", "severity", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ModerationCase_targetType_targetId_idx" ON "ModerationCase"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReport_reportId_key" ON "CaseReport"("reportId");

-- CreateIndex
CREATE INDEX "AuditEvent_caseId_createdAt_id_idx" ON "AuditEvent"("caseId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_createdAt_idx" ON "AuditEvent"("resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_adminUserId_createdAt_idx" ON "AuditEvent"("adminUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_openedByAdminUserId_fkey" FOREIGN KEY ("openedByAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReport" ADD CONSTRAINT "CaseReport_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReport" ADD CONSTRAINT "CaseReport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-owned constraints/indexes. Do not regenerate away the historical FTS column.
CREATE UNIQUE INDEX "Report_one_unresolved" ON "Report"("reporterUserId","targetType","targetId") WHERE status IN ('OPEN','IN_REVIEW');
ALTER TABLE "Report" ADD CONSTRAINT "Report_details_bound" CHECK ("details" IS NULL OR length(btrim("details")) BETWEEN 1 AND 2000);
ALTER TABLE "Report" ADD CONSTRAINT "Report_other_details" CHECK ("reasonCode" <> 'OTHER' OR "details" IS NOT NULL);
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolution" CHECK ((status IN ('RESOLVED','DISMISSED')) = ("resolvedAt" IS NOT NULL));
ALTER TABLE "ModerationCase" ADD CONSTRAINT "Case_resolution" CHECK (
  (status = 'CLOSED' AND "closedAt" IS NOT NULL AND "resolutionCode" IN ('RESOLVED','DISMISSED') AND length(btrim("resolutionNote")) BETWEEN 1 AND 2000)
  OR (status <> 'CLOSED' AND "closedAt" IS NULL AND "resolutionCode" IS NULL AND "resolutionNote" IS NULL));
ALTER TABLE "AuditEvent" ADD CONSTRAINT "Audit_reason_metadata" CHECK (length(btrim(reason)) BETWEEN 1 AND 2000 AND jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 1024);
CREATE INDEX "Job_visible_published" ON "Job"("publishedAt",id) WHERE status = 'PUBLISHED' AND "moderationHiddenAt" IS NULL;
DROP INDEX "Job_published_search_gin";
CREATE INDEX "Job_published_search_gin" ON "Job" USING GIN ("searchVector") WHERE status = 'PUBLISHED' AND "moderationHiddenAt" IS NULL;

CREATE FUNCTION "moderation_target_exists"(kind "ModerationTarget", target TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT CASE kind
    WHEN 'JOB' THEN EXISTS(SELECT 1 FROM "Job" WHERE id=target)
    WHEN 'REVIEW' THEN EXISTS(SELECT 1 FROM "Review" WHERE id=target)
    WHEN 'USER' THEN EXISTS(SELECT 1 FROM "User" WHERE id=target)
    WHEN 'MESSAGE' THEN EXISTS(SELECT 1 FROM "Message" WHERE id=target)
    WHEN 'COMPANY' THEN EXISTS(SELECT 1 FROM "Company" WHERE id=target)
    WHEN 'ENGAGEMENT' THEN EXISTS(SELECT 1 FROM "Engagement" WHERE id=target)
    ELSE false END
$$;
CREATE FUNCTION "guard_moderation_target"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."targetType",NEW."targetId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."targetType",OLD."targetId",OLD."createdAt") THEN
    RAISE EXCEPTION 'Immutable moderation target' USING ERRCODE='23514';
  END IF;
  IF NOT "moderation_target_exists"(NEW."targetType",NEW."targetId") THEN RAISE EXCEPTION 'Missing moderation target' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='Report' AND TG_OP='UPDATE' THEN
    IF ROW(NEW."reporterUserId",NEW."reasonCode",NEW.details) IS DISTINCT FROM ROW(OLD."reporterUserId",OLD."reasonCode",OLD.details)
      OR (OLD.status IN ('RESOLVED','DISMISSED') AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status<>OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status='IN_REVIEW') OR (OLD.status='IN_REVIEW' AND NEW.status IN ('RESOLVED','DISMISSED'))))
    THEN RAISE EXCEPTION 'Invalid report transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='ModerationCase' AND TG_OP='UPDATE' THEN
    IF NEW."openedByAdminUserId"<>OLD."openedByAdminUserId" OR NEW.severity<>OLD.severity
      OR (OLD.status='CLOSED' AND NEW IS DISTINCT FROM OLD)
      OR (NEW.status<>OLD.status AND NOT ((OLD.status='OPEN' AND NEW.status IN ('INVESTIGATING','ACTIONED','CLOSED'))
        OR (OLD.status='INVESTIGATING' AND NEW.status IN ('ACTIONED','CLOSED')) OR (OLD.status='ACTIONED' AND NEW.status='CLOSED')))
    THEN RAISE EXCEPTION 'Invalid case transition' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Report_target_history" BEFORE INSERT OR UPDATE ON "Report" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_target"();
CREATE TRIGGER "Case_target_history" BEFORE INSERT OR UPDATE ON "ModerationCase" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_target"();
CREATE FUNCTION "guard_case_report"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "ModerationCase" c JOIN "Report" r ON r.id=NEW."reportId"
    WHERE c.id=NEW."caseId" AND c.status<>'CLOSED' AND r.status IN ('OPEN','IN_REVIEW')
    AND c."targetType"=r."targetType" AND c."targetId"=r."targetId")
  THEN RAISE EXCEPTION 'Case report binding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaseReport_binding" BEFORE INSERT OR UPDATE ON "CaseReport" FOR EACH ROW EXECUTE FUNCTION "guard_case_report"();
CREATE FUNCTION "guard_moderation_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "ModerationTarget";
BEGIN
  kind := CASE TG_TABLE_NAME WHEN 'Job' THEN 'JOB' WHEN 'User' THEN 'USER' WHEN 'Review' THEN 'REVIEW'
    WHEN 'Message' THEN 'MESSAGE' WHEN 'Company' THEN 'COMPANY' ELSE 'ENGAGEMENT' END;
  IF EXISTS(SELECT 1 FROM "Report" WHERE "targetType"=kind AND "targetId"=OLD.id)
    OR EXISTS(SELECT 1 FROM "ModerationCase" WHERE "targetType"=kind AND "targetId"=OLD.id)
  THEN RAISE EXCEPTION 'Referenced moderation history' USING ERRCODE='23503'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "Job_moderation_restrict" BEFORE DELETE ON "Job" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();
CREATE TRIGGER "User_moderation_restrict" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();
CREATE TRIGGER "Review_moderation_restrict" BEFORE DELETE ON "Review" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();
CREATE TRIGGER "Message_moderation_restrict" BEFORE DELETE ON "Message" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();
CREATE TRIGGER "Company_moderation_restrict" BEFORE DELETE ON "Company" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();
CREATE TRIGGER "Engagement_moderation_restrict" BEFORE DELETE ON "Engagement" FOR EACH ROW EXECUTE FUNCTION "guard_moderation_delete"();

CREATE FUNCTION "guard_admin_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable admin audit' USING ERRCODE='23514'; END IF;
  IF NEW."transactionId"<>pg_current_xact_id()::text OR NOT EXISTS (
    SELECT 1 FROM "ModerationCase" c JOIN "User" u ON u.id=NEW."adminUserId"
    JOIN "UserRole" r ON r."userId"=u.id AND r.role='ADMIN'
    WHERE c.id=NEW."caseId" AND c."targetType"=NEW."resourceType" AND c."targetId"=NEW."resourceId" AND u.status='ACTIVE'
  ) THEN RAISE EXCEPTION 'Invalid admin audit authority' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Audit_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "guard_admin_audit"();
CREATE FUNCTION "require_moderation_audit"(audit TEXT, kind "ModerationTarget", target TEXT, expected "AuditAction") RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "AuditEvent" a JOIN "ModerationCase" c ON c.id=a."caseId"
    WHERE a.id=audit AND a."transactionId"=pg_current_xact_id()::text AND a."resourceType"=kind
      AND a."resourceId"=target AND a.action=expected AND c.status<>'CLOSED')
  THEN RAISE EXCEPTION 'Case-bound audit required' USING ERRCODE='23514'; END IF;
END $$;
-- Keep the Phase 8 INSERT authority guard. Replace only its UPDATE behavior.
DROP TRIGGER "Review_immutable_history" ON "Review";
CREATE TRIGGER "Review_completed_insert" BEFORE INSERT ON "Review" FOR EACH ROW EXECUTE FUNCTION "guard_review_history"();
CREATE FUNCTION "guard_review_moderation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'hiddenAt'-'moderationAuditId') IS DISTINCT FROM (to_jsonb(OLD)-'hiddenAt'-'moderationAuditId')
  THEN RAISE EXCEPTION 'Immutable review content' USING ERRCODE='23514'; END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    IF (NEW."hiddenAt" IS NULL)=(OLD."hiddenAt" IS NULL) THEN RAISE EXCEPTION 'Invalid review visibility transition' USING ERRCODE='23514'; END IF;
    PERFORM "require_moderation_audit"(NEW."moderationAuditId",'REVIEW',NEW.id,CASE WHEN NEW."hiddenAt" IS NULL THEN 'REVIEW_UNHIDDEN'::"AuditAction" ELSE 'REVIEW_HIDDEN'::"AuditAction" END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Review_immutable_history" BEFORE UPDATE ON "Review" FOR EACH ROW EXECUTE FUNCTION "guard_review_moderation"();
CREATE FUNCTION "guard_job_moderation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."moderationHiddenAt",NEW."moderationAuditId") IS DISTINCT FROM ROW(OLD."moderationHiddenAt",OLD."moderationAuditId") THEN
    IF (NEW."moderationHiddenAt" IS NULL)=(OLD."moderationHiddenAt" IS NULL) THEN RAISE EXCEPTION 'Invalid job visibility transition' USING ERRCODE='23514'; END IF;
    PERFORM "require_moderation_audit"(NEW."moderationAuditId",'JOB',NEW.id,CASE WHEN NEW."moderationHiddenAt" IS NULL THEN 'JOB_UNHIDDEN'::"AuditAction" ELSE 'JOB_HIDDEN'::"AuditAction" END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Job_moderation_audit" BEFORE UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION "guard_job_moderation"();
-- FORCE completion does not fabricate a Worker request; admin cancellation has no participant cancelledBy.
ALTER TABLE "Engagement" DROP CONSTRAINT "Engagement_lifecycle";
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_lifecycle" CHECK (
  (status<>'IN_PROGRESS' OR "startedAt" IS NOT NULL) AND ("completionRequestedAt" IS NULL OR "startedAt" IS NOT NULL)
  AND (status<>'COMPLETED' OR ("startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND ("completionRequestedAt" IS NOT NULL OR "moderationAuditId" IS NOT NULL)))
  AND (status<>'CANCELLED' OR ("cancelledAt" IS NOT NULL AND
    (("moderationAuditId" IS NOT NULL AND "cancelledBy" IS NULL AND "cancellationCategory" IS NULL AND "cancellationReason" IS NULL)
      OR ("moderationAuditId" IS NULL AND "cancelledBy" IS NOT NULL AND "cancellationCategory" IN ('PERSONAL','SCHEDULE','TERMS','OTHER') AND length("cancellationReason") BETWEEN 1 AND 500)))));
CREATE FUNCTION "guard_engagement_moderation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."moderationAuditId" IS DISTINCT FROM OLD."moderationAuditId" THEN
    IF OLD.status NOT IN ('ACCEPTED','IN_PROGRESS') OR NEW.status NOT IN ('COMPLETED','CANCELLED')
      OR (NEW.status='COMPLETED' AND OLD.status<>'IN_PROGRESS')
      OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" OR NEW."completionRequestedAt" IS DISTINCT FROM OLD."completionRequestedAt"
    THEN RAISE EXCEPTION 'Invalid forced lifecycle' USING ERRCODE='23514'; END IF;
    PERFORM "require_moderation_audit"(NEW."moderationAuditId",'ENGAGEMENT',NEW.id,CASE WHEN NEW.status='COMPLETED' THEN 'ENGAGEMENT_FORCE_COMPLETED'::"AuditAction" ELSE 'ENGAGEMENT_FORCE_CANCELLED'::"AuditAction" END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Engagement_moderation_audit" BEFORE UPDATE ON "Engagement" FOR EACH ROW EXECUTE FUNCTION "guard_engagement_moderation"();
CREATE FUNCTION "guard_user_moderation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Operational fixture/provisioning writers are trusted DB access, not an API.
  IF NEW."moderationAuditId" IS DISTINCT FROM OLD."moderationAuditId" THEN
    IF NOT ((OLD.status='ACTIVE' AND NEW.status IN ('SUSPENDED','BANNED')) OR (OLD.status='SUSPENDED' AND NEW.status IN ('ACTIVE','BANNED')))
    THEN RAISE EXCEPTION 'Invalid account moderation' USING ERRCODE='23514'; END IF;
    PERFORM "require_moderation_audit"(NEW."moderationAuditId",'USER',NEW.id,CASE NEW.status WHEN 'SUSPENDED' THEN 'USER_SUSPENDED'::"AuditAction" WHEN 'ACTIVE' THEN 'USER_UNSUSPENDED'::"AuditAction" ELSE 'USER_BANNED'::"AuditAction" END);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_moderation_audit" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION "guard_user_moderation"();
-- Prevent a successful resource-action audit without the matching resource write.
CREATE FUNCTION "check_audit_effect"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE applied BOOLEAN;
BEGIN
  applied := CASE
    WHEN NEW.action IN ('JOB_HIDDEN','JOB_UNHIDDEN') THEN EXISTS(SELECT 1 FROM "Job" WHERE id=NEW."resourceId" AND "moderationAuditId"=NEW.id AND ("moderationHiddenAt" IS NOT NULL)=(NEW.action='JOB_HIDDEN'))
    WHEN NEW.action IN ('REVIEW_HIDDEN','REVIEW_UNHIDDEN') THEN EXISTS(SELECT 1 FROM "Review" WHERE id=NEW."resourceId" AND "moderationAuditId"=NEW.id AND ("hiddenAt" IS NOT NULL)=(NEW.action='REVIEW_HIDDEN'))
    WHEN NEW.action IN ('USER_SUSPENDED','USER_UNSUSPENDED','USER_BANNED') THEN EXISTS(SELECT 1 FROM "User" WHERE id=NEW."resourceId" AND "moderationAuditId"=NEW.id AND status::text=CASE NEW.action WHEN 'USER_SUSPENDED' THEN 'SUSPENDED' WHEN 'USER_UNSUSPENDED' THEN 'ACTIVE' ELSE 'BANNED' END)
    WHEN NEW.action IN ('ENGAGEMENT_FORCE_COMPLETED','ENGAGEMENT_FORCE_CANCELLED') THEN EXISTS(SELECT 1 FROM "Engagement" WHERE id=NEW."resourceId" AND "moderationAuditId"=NEW.id AND status::text=CASE NEW.action WHEN 'ENGAGEMENT_FORCE_COMPLETED' THEN 'COMPLETED' ELSE 'CANCELLED' END)
    ELSE true END;
  IF NOT applied THEN RAISE EXCEPTION 'Audit effect missing' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Audit_effect_required" AFTER INSERT ON "AuditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_audit_effect"();
