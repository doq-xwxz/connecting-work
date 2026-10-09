import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/shared/errors/app-error";

// Public recruiting visibility boundary, shared by FTS, reputation and matching.
// Company ownership is current membership, never the originating employer.
export const visibleRecruitingWhere: Prisma.JobWhereInput = { moderationHiddenAt: null, OR: [
  { companyId: null, employer: { user: { status: { not: "BANNED" } } } },
  { company: { members: { some: { role: { in: ["OWNER", "MANAGER"] }, user: { status: { not: "BANNED" }, roles: { some: { role: "EMPLOYER" } } } } } } },
] };
export const visibleRecruitingSql = Prisma.sql`j."moderationHiddenAt" IS NULL AND (
  (j."companyId" IS NULL AND EXISTS(SELECT 1 FROM "EmployerProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=j."employerProfileId" AND u.status<>'BANNED'))
  OR (j."companyId" IS NOT NULL AND EXISTS(SELECT 1 FROM "CompanyMember" m JOIN "User" u ON u.id=m."userId" JOIN "UserRole" r ON r."userId"=u.id AND r.role='EMPLOYER'
    WHERE m."companyId"=j."companyId" AND m.role IN ('OWNER','MANAGER') AND u.status<>'BANNED'))) `;
export async function requireRecruitingVisible(tx: Prisma.TransactionClient, jobId: string) {
  if (!await tx.job.findFirst({ where: { AND: [{ id: jobId }, visibleRecruitingWhere] }, select: { id: true } })) throw new AppError("CONFLICT");
}
export async function lockModerationJob(tx: Prisma.TransactionClient, id: string) {
  const scope = await tx.job.findUnique({ where: { id }, select: { companyId: true, employerProfileId: true } });
  if (!scope) throw new AppError("NOT_FOUND");
  if (scope.companyId) await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${scope.companyId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "EmployerProfile" WHERE id=${scope.employerProfileId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id=${id} FOR UPDATE`;
  return tx.job.findUniqueOrThrow({ where: { id }, select: { id: true, title: true, status: true, moderationHiddenAt: true } });
}
export async function moderateJob(tx: Prisma.TransactionClient, id: string, hidden: boolean, auditId: string, now: Date) {
  // Caller has already taken owner→Job and case locks and inserted bound audit.
  const row = await tx.job.findUniqueOrThrow({ where: { id }, select: { moderationHiddenAt: true } });
  if (Boolean(row.moderationHiddenAt) === hidden) throw new AppError("CONFLICT");
  await tx.job.update({ where: { id }, data: { moderationHiddenAt: hidden ? now : null, moderationAuditId: auditId, version: { increment: 1 } } });
}
