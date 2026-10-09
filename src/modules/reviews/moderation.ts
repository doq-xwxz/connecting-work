import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { lockModerationEngagement } from "@/modules/hiring/moderation";
import { AppError } from "@/shared/errors/app-error";

export async function lockModerationReview(tx: Prisma.TransactionClient, id: string) {
  const initial = await tx.review.findUnique({ where: { id }, select: { engagementId: true } });
  if (!initial) throw new AppError("NOT_FOUND");
  await lockModerationEngagement(tx, initial.engagementId);
  await tx.$queryRaw`SELECT id FROM "Review" WHERE id=${id} FOR UPDATE`;
  return tx.review.findUniqueOrThrow({ where: { id }, select: { id: true, rating: true, comment: true, direction: true, hiddenAt: true } });
}
export async function moderateReview(tx: Prisma.TransactionClient, id: string, hidden: boolean, auditId: string, now: Date) {
  const row = await tx.review.findUniqueOrThrow({ where: { id }, select: { hiddenAt: true } });
  if (Boolean(row.hiddenAt) === hidden) throw new AppError("CONFLICT");
  await tx.review.update({ where: { id }, data: { hiddenAt: hidden ? now : null, moderationAuditId: auditId } });
}
