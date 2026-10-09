import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { lockModerationJob } from "@/modules/jobs/moderation";
import { forceTransition } from "@/modules/moderation/contracts";
import { AppError } from "@/shared/errors/app-error";

export async function lockModerationEngagement(tx: Prisma.TransactionClient, id: string) {
  const initial = await tx.engagement.findUnique({ where: { id }, select: { jobId: true, applicationId: true, acceptedOfferId: true } });
  if (!initial) throw new AppError("NOT_FOUND");
  await lockModerationJob(tx, initial.jobId);
  await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${initial.applicationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Offer" WHERE id=${initial.acceptedOfferId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Engagement" WHERE id=${id} FOR UPDATE`;
  return tx.engagement.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, jobId: true, acceptedAt: true,
    startedAt: true, completionRequestedAt: true, completedAt: true, cancelledAt: true } });
}
export async function forceEngagement(tx: Prisma.TransactionClient, id: string, action: "force-complete" | "force-cancel", auditId: string, now: Date) {
  const row = await tx.engagement.findUniqueOrThrow({ where: { id }, select: { status: true } });
  const status = forceTransition(row.status, action);
  await tx.engagement.update({ where: { id }, data: { status, moderationAuditId: auditId,
    ...(status === "COMPLETED" ? { completedAt: now } : { cancelledAt: now, cancelledBy: null, cancellationCategory: null, cancellationReason: null }) } });
}
