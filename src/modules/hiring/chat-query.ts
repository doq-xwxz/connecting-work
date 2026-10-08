import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { managedRow } from "@/modules/jobs/service";
import { requireEmployerProfile, requireWorkerProfile } from "@/modules/profiles/access";
import { AppError } from "@/shared/errors/app-error";

// Public transaction query boundary. Job locks serialize all hiring-state changes.
export async function lockChatApplication(tx: Prisma.TransactionClient, actor: Principal, side: "WORKER" | "EMPLOYER", id: string) {
  const initial = await tx.application.findUnique({ where: { id }, select: { jobId: true, worker: { select: { id: true, userId: true } } } });
  if (!initial) throw new AppError("NOT_FOUND");
  if (side === "WORKER" && (await requireWorkerProfile(tx, actor.id)).id !== initial.worker.id) throw new AppError("NOT_FOUND");
  // One PG transaction lock per Worker contact scope serializes blocks across Jobs.
  // It locks no second User/Profile row, avoiding FK/owner lock inversions.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('messaging-worker:' || ${initial.worker.userId}, 0))::text`;
  if (side === "EMPLOYER") await managedRow(tx, actor, (await requireEmployerProfile(tx, actor.id)).id, initial.jobId, true);
  else {
    const owner = await tx.job.findUniqueOrThrow({ where: { id: initial.jobId }, select: { companyId: true, employerProfileId: true } });
    if (owner.companyId) await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${owner.companyId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "EmployerProfile" WHERE "id" = ${owner.employerProfileId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${initial.jobId} FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${id} FOR UPDATE`;
  return tx.application.findUniqueOrThrow({ where: { id }, select: { id: true, jobId: true, workerProfileId: true, status: true,
    engagement: { select: { status: true } }, worker: { select: { userId: true, user: { select: { name: true, status: true } } } },
    job: { select: { id: true, title: true, status: true, companyId: true, company: { select: { name: true } }, employer: { select: { userId: true, user: { select: { name: true, status: true } } } } } } } });
}
