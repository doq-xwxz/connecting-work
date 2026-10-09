import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { managedRow } from "@/modules/jobs/service";
import { requireEmployerProfile, requireWorkerProfile } from "@/modules/profiles/access";
import { AppError } from "@/shared/errors/app-error";

// Public relationship query, preserving canonical hiring lock order without
// messaging's unrelated contact lock or an import back into review services.
export async function lockReviewEngagement(tx: Prisma.TransactionClient, actor: Principal, side: "WORKER" | "EMPLOYER", id: string) {
  const initial = await tx.engagement.findUnique({ where: { id }, select: { applicationId: true, jobId: true, workerProfileId: true } });
  if (!initial) throw new AppError("NOT_FOUND");
  if (side === "EMPLOYER") await managedRow(tx, actor, (await requireEmployerProfile(tx, actor.id)).id, initial.jobId, true);
  else {
    if ((await requireWorkerProfile(tx, actor.id)).id !== initial.workerProfileId) throw new AppError("NOT_FOUND");
    const owner = await tx.job.findUniqueOrThrow({ where: { id: initial.jobId }, select: { companyId: true, employerProfileId: true } });
    if (owner.companyId) await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${owner.companyId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "EmployerProfile" WHERE "id" = ${owner.employerProfileId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${initial.jobId} FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${initial.applicationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Engagement" WHERE "id" = ${id} FOR UPDATE`;
  return tx.engagement.findUniqueOrThrow({ where: { id }, include: { job: { select: { companyId: true, employerProfileId: true } } } });
}
