-- CreateEnum
-- Additive Phase 4 only. Prior migrations are unchanged.
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobCategory" AS ENUM ('ADMIN_OPERATIONS', 'FINANCE_ACCOUNTING', 'MARKETING', 'CREATIVE', 'GENERAL_PART_TIME');

-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('HOURLY', 'DAILY', 'PROJECT', 'MONTHLY');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "employerProfileId" TEXT NOT NULL,
    "companyId" TEXT,
    "creationKey" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" "JobCategory",
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType",
    "workMode" "WorkMode",
    "city" TEXT,
    "compensationType" "CompensationType",
    "compensationMin" BIGINT,
    "compensationMax" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "startDate" DATE,
    "endDate" DATE,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSkill" (
    "jobId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minimumLevel" "SkillLevel" NOT NULL DEFAULT 'BEGINNER',

    CONSTRAINT "JobSkill_pkey" PRIMARY KEY ("jobId","skillId")
);

-- CreateTable
CREATE TABLE "JobScheduleWindow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,

    CONSTRAINT "JobScheduleWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_id_idx" ON "Job"("status", "id");

-- CreateIndex
CREATE INDEX "Job_employerProfileId_companyId_status_idx" ON "Job"("employerProfileId", "companyId", "status");

-- CreateIndex
CREATE INDEX "Job_companyId_status_idx" ON "Job"("companyId", "status");

-- CreateIndex
CREATE INDEX "Job_status_city_employmentType_workMode_id_idx" ON "Job"("status", "city", "employmentType", "workMode", "id");

-- CreateIndex
CREATE INDEX "Job_status_publishedAt_id_idx" ON "Job"("status", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "Job_category_status_id_idx" ON "Job"("category", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_createdByUserId_creationKey_key" ON "Job"("createdByUserId", "creationKey");

-- CreateIndex
CREATE INDEX "JobSkill_skillId_jobId_idx" ON "JobSkill"("skillId", "jobId");

-- CreateIndex
CREATE INDEX "JobScheduleWindow_jobId_weekday_idx" ON "JobScheduleWindow"("jobId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "JobScheduleWindow_jobId_weekday_startHour_endHour_key" ON "JobScheduleWindow"("jobId", "weekday", "startHour", "endHour");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_employerProfileId_fkey" FOREIGN KEY ("employerProfileId") REFERENCES "EmployerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSkill" ADD CONSTRAINT "JobSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScheduleWindow" ADD CONSTRAINT "JobScheduleWindow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Critical invariants independent of browser/TypeScript validation.
ALTER TABLE "Job" ADD CONSTRAINT "Job_headcount_version_check" CHECK ("headcount" BETWEEN 1 AND 1000 AND "version" >= 1);
ALTER TABLE "Job" ADD CONSTRAINT "Job_compensation_check" CHECK (
  "currency" = 'VND' AND (("compensationMin" IS NULL AND "compensationMax" IS NULL) OR
  ("compensationMin" IS NOT NULL AND "compensationMax" IS NOT NULL AND "compensationType" IS NOT NULL
   AND "compensationMin" >= 0 AND "compensationMax" >= "compensationMin" AND "compensationMax" <= 1000000000000)));
ALTER TABLE "Job" ADD CONSTRAINT "Job_dates_check" CHECK (
  ("startDate" IS NULL OR "startDate" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31') AND
  ("endDate" IS NULL OR ("startDate" IS NOT NULL AND "endDate" >= "startDate" AND "endDate" <= DATE '2100-12-31')));
ALTER TABLE "Job" ADD CONSTRAINT "Job_lifecycle_timestamps_check" CHECK (
  ("status" NOT IN ('PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED') OR "publishedAt" IS NOT NULL) AND
  ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL) AND ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL));
ALTER TABLE "JobScheduleWindow" ADD CONSTRAINT "JobScheduleWindow_window_check" CHECK (
  "weekday" BETWEEN 0 AND 6 AND "startHour" BETWEEN 0 AND 23 AND "endHour" BETWEEN 1 AND 24 AND "startHour" < "endHour");
