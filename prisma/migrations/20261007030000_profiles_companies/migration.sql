-- CreateEnum
CREATE TYPE "SkillLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'TEMPORARY', 'FREELANCE', 'PROJECT', 'SHIFT', 'INTERNSHIP');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "EmployerType" AS ENUM ('INDIVIDUAL', 'SHOP', 'STARTUP', 'SME', 'COMPANY', 'AGENCY');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "CompanyVerification" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "city" TEXT,
    "bio" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "discoverable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSkill" (
    "workerProfileId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL,

    CONSTRAINT "WorkerSkill_pkey" PRIMARY KEY ("workerProfileId","skillId")
);

-- CreateTable
CREATE TABLE "WorkerPreference" (
    "workerProfileId" TEXT NOT NULL,
    "type" "EmploymentType" NOT NULL,

    CONSTRAINT "WorkerPreference_pkey" PRIMARY KEY ("workerProfileId","type")
);

-- CreateTable
CREATE TABLE "WorkerWorkMode" (
    "workerProfileId" TEXT NOT NULL,
    "mode" "WorkMode" NOT NULL,

    CONSTRAINT "WorkerWorkMode_pkey" PRIMARY KEY ("workerProfileId","mode")
);

-- CreateTable
CREATE TABLE "WorkerAvailability" (
    "id" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,

    CONSTRAINT "WorkerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EmployerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "description" TEXT NOT NULL DEFAULT '',
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "city" TEXT,
    "website" TEXT,
    "verification" "CompanyVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "createdByUserId" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMember" (
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("companyId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- CreateIndex
CREATE INDEX "Skill_active_category_idx" ON "Skill"("active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerProfile_userId_key" ON "WorkerProfile"("userId");

-- CreateIndex
CREATE INDEX "WorkerProfile_discoverable_city_id_idx" ON "WorkerProfile"("discoverable", "city", "id");

-- CreateIndex
CREATE INDEX "WorkerSkill_skillId_workerProfileId_idx" ON "WorkerSkill"("skillId", "workerProfileId");

-- CreateIndex
CREATE INDEX "WorkerPreference_type_workerProfileId_idx" ON "WorkerPreference"("type", "workerProfileId");

-- CreateIndex
CREATE INDEX "WorkerAvailability_workerProfileId_weekday_idx" ON "WorkerAvailability"("workerProfileId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerAvailability_workerProfileId_weekday_startHour_endHou_key" ON "WorkerAvailability"("workerProfileId", "weekday", "startHour", "endHour");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerProfile_userId_key" ON "EmployerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_createdByUserId_creationKey_key" ON "Company"("createdByUserId", "creationKey");

-- CreateIndex
CREATE INDEX "CompanyMember_userId_companyId_idx" ON "CompanyMember"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSkill" ADD CONSTRAINT "WorkerSkill_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSkill" ADD CONSTRAINT "WorkerSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerPreference" ADD CONSTRAINT "WorkerPreference_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerWorkMode" ADD CONSTRAINT "WorkerWorkMode_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerAvailability" ADD CONSTRAINT "WorkerAvailability_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerProfile" ADD CONSTRAINT "EmployerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- V1 civil weekly windows, never minute-by-minute or implicit UTC offsets.
ALTER TABLE "WorkerAvailability" ADD CONSTRAINT "WorkerAvailability_window_check"
  CHECK ("weekday" BETWEEN 0 AND 6 AND "startHour" BETWEEN 0 AND 23
    AND "endHour" BETWEEN 1 AND 24 AND "startHour" < "endHour");
-- Exactly one OWNER is created by the service; public removal of OWNER is denied.
-- This at-most-one constraint prevents accidental second-owner provisioning.
CREATE UNIQUE INDEX "CompanyMember_one_owner_key" ON "CompanyMember"("companyId") WHERE "role" = 'OWNER';

-- Small controlled, extensible starter taxonomy: two skills per initial category.
INSERT INTO "Skill" ("id", "slug", "name", "category", "updatedAt") VALUES
('10000000-0000-4000-8000-000000000001', 'data-entry', 'Nhập liệu', 'ADMIN_OPERATIONS', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000002', 'office-operations', 'Vận hành văn phòng', 'ADMIN_OPERATIONS', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000003', 'excel', 'Excel', 'FINANCE_ACCOUNTING', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000004', 'bookkeeping', 'Hỗ trợ sổ sách kế toán', 'FINANCE_ACCOUNTING', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000005', 'content-writing', 'Viết nội dung', 'MARKETING', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000006', 'social-media', 'Vận hành mạng xã hội', 'MARKETING', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000007', 'graphic-design', 'Thiết kế đồ họa', 'CREATIVE', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000008', 'video-editing', 'Biên tập video', 'CREATIVE', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000009', 'event-support', 'Hỗ trợ sự kiện', 'GENERAL_PART_TIME', CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000010', 'shop-assistance', 'Hỗ trợ cửa hàng', 'GENERAL_PART_TIME', CURRENT_TIMESTAMP);
