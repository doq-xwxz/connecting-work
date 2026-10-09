import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { accountTransition } from "@/modules/moderation/contracts";
import { AppError } from "@/shared/errors/app-error";

// Caller takes sorted actor+target User NO KEY UPDATE locks before these owners.
// Ban must serialize with Apply/accept/search scope, not only target's own writes.
export async function lockModerationAccountScopes(tx: Prisma.TransactionClient, id: string) {
  const user = await tx.user.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!user) throw new AppError("NOT_FOUND");
  await tx.$queryRaw`SELECT id FROM "EmployerProfile" WHERE "userId"=${id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT c.id FROM "Company" c JOIN "CompanyMember" m ON m."companyId"=c.id WHERE m."userId"=${id} ORDER BY c.id FOR UPDATE OF c`;
  return user;
}
export async function moderateAccount(tx: Prisma.TransactionClient, id: string, action: "suspend" | "unsuspend" | "ban", auditId: string) {
  const row = await tx.user.findUniqueOrThrow({ where: { id }, select: { status: true } });
  await tx.user.update({ where: { id }, data: { status: accountTransition(row.status, action), moderationAuditId: auditId } });
}
