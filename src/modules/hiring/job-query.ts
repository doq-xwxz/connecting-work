import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/shared/errors/app-error";
import { activeStatuses, occupiedStatuses, preAcceptance } from "./policy";

// Public transaction query/orchestration boundary. Caller holds owner scope + Job.
// No import of Jobs services: this dependency remains acyclic.
export async function hiringEditContext(tx: Prisma.TransactionClient, jobId: string) {
  const hasApplications = (await tx.application.count({ where: { jobId } })) > 0;
  const occupiedSlots = await tx.engagement.count({ where: { jobId, status: { in: occupiedStatuses } } });
  return { phase: "HIRING" as const, hasApplications, occupiedSlots };
}
export async function finishRecruitment(tx: Prisma.TransactionClient, jobId: string, status: "CANCELLED" | "COMPLETED", now: Date) {
  if (await tx.engagement.count({ where: { jobId, status: { in: activeStatuses } } })) throw new AppError("CONFLICT");
  if (status === "COMPLETED" && !(await tx.engagement.count({ where: { jobId, status: "COMPLETED" } }))) throw new AppError("CONFLICT");
  // Every hiring write first takes Job; dependent rows cannot change concurrently.
  await tx.application.updateMany({ where: { jobId, status: { in: preAcceptance }, engagement: null }, data: { status: "CANCELLED", cancelledAt: now } });
  await tx.offer.updateMany({ where: { jobId, status: "PENDING" }, data: { status: "REVOKED", resolvedAt: now } });
}
