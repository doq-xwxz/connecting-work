import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { lockModerationJob, visibleRecruitingWhere } from "@/modules/jobs/moderation";
import { lockModerationEngagement } from "@/modules/hiring/moderation";
import { lockModerationReview } from "@/modules/reviews/moderation";
import { authorizeReportedMessage } from "@/modules/messaging/moderation";
import { AppError } from "@/shared/errors/app-error";
import type { Target } from "./contracts";

// Public orchestration projections: relation conditions derive only from fresh actor.
function management(actorId: string): Prisma.JobWhereInput {
  return { OR: [{ companyId: null, employer: { userId: actorId } }, { company: { members: { some: { userId: actorId, role: { in: ["OWNER", "MANAGER"] } } } } }] };
}
function relationship(actor: Principal): Prisma.JobWhereInput {
  return { OR: [
    ...(actor.roles.includes("EMPLOYER") ? [management(actor.id)] : []),
    ...(actor.roles.includes("WORKER") ? [{ applications: { some: { worker: { userId: actor.id } } } }] : []),
  ] };
}
export async function authorizeReportTarget(tx: Prisma.TransactionClient, actor: Principal, type: Target, id: string) {
  if (type === "MESSAGE") return authorizeReportedMessage(tx, actor, id);
  if (type === "ENGAGEMENT") {
    await lockModerationEngagement(tx, id);
    const row = await tx.engagement.findFirst({ where: { id, OR: [
      ...(actor.roles.includes("WORKER") ? [{ worker: { userId: actor.id } }] : []),
      ...(actor.roles.includes("EMPLOYER") ? [{ job: management(actor.id) }] : []),
    ], ...(actor.status === "SUSPENDED" ? { status: { in: ["ACCEPTED", "IN_PROGRESS"] } } : {}) }, select: { id: true } });
    if (!row) throw new AppError("NOT_FOUND");
    return;
  }
  if (actor.status !== "ACTIVE") throw new AppError("FORBIDDEN");
  if (type === "JOB") await lockModerationJob(tx, id);
  if (type === "REVIEW") await lockModerationReview(tx, id);
  if (type === "COMPANY") await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${id} FOR UPDATE`;
  let allowed = false;
  if (type === "JOB") allowed = !!await tx.job.findFirst({ where: { id, OR: [{ AND: [{ status: "PUBLISHED" }, visibleRecruitingWhere] }, relationship(actor)] }, select: { id: true } });
  if (type === "COMPANY") allowed = !!await tx.company.findFirst({ where: { id, OR: [
    { jobs: { some: { AND: [{ status: "PUBLISHED" }, visibleRecruitingWhere] } } }, { jobs: { some: relationship(actor) } },
    ...(actor.roles.includes("EMPLOYER") ? [{ members: { some: { userId: actor.id } } }] : []),
  ] }, select: { id: true } });
  if (type === "USER") {
    // No user directory: a participant may report the known opposite party only.
    const scope: Prisma.ApplicationWhereInput = { OR: [
      ...(actor.roles.includes("EMPLOYER") ? [{ worker: { userId: id }, job: management(actor.id) }] : []),
      ...(actor.roles.includes("WORKER") ? [{ worker: { userId: actor.id }, job: { OR: [
        { companyId: null, employer: { userId: id } }, { company: { members: { some: { userId: id } } } },
      ] } }] : []),
    ] };
    const source = id !== actor.id ? await tx.application.findFirst({ where: scope, select: { jobId: true }, orderBy: { id: "asc" } }) : null;
    if (source) {
      await lockModerationJob(tx, source.jobId);
      allowed = !!await tx.application.findFirst({ where: { AND: [{ jobId: source.jobId }, scope] }, select: { id: true } });
    }
  }
  const canDiscover = type === "REVIEW" && actor.roles.includes("EMPLOYER") && !!await tx.employerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (type === "REVIEW") allowed = !!await tx.review.findFirst({ where: { id, hiddenAt: null, engagement: { status: "COMPLETED" }, OR: [
    // Both current participants can read their completed relationship's reviews.
    ...(actor.roles.includes("WORKER") ? [{ engagement: { worker: { userId: actor.id } } }] : []),
    ...(actor.roles.includes("EMPLOYER") ? [{ engagement: { job: management(actor.id) } }] : []),
    ...(actor.roles.includes("WORKER") ? [{ direction: "WORKER_TO_EMPLOYER" as const, OR: [
      { company: { jobs: { some: { AND: [{ status: "PUBLISHED" as const }, visibleRecruitingWhere] } } } },
      { companyId: null, employer: { jobs: { some: { AND: [{ companyId: null, status: "PUBLISHED" as const }, visibleRecruitingWhere] } } } },
    ] }] : []),
    ...(canDiscover ? [{ direction: "EMPLOYER_TO_WORKER" as const, worker: { OR: [
      { discoverable: true, user: { status: "ACTIVE" as const, roles: { some: { role: "WORKER" as const } } } },
      { applications: { some: { job: management(actor.id) } } },
    ] } }] : []),
  ] }, select: { id: true } });
  if (!allowed) throw new AppError("NOT_FOUND");
}
