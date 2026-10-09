import "server-only";
import type { Prisma, PrismaClient, Review } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { opaqueId, parse } from "@/modules/profiles/contracts";
import { requireEmployerProfile } from "@/modules/profiles/access";
import { lockReviewEngagement } from "@/modules/hiring/review-query";
import { acceptedSnapshotSchema } from "@/modules/hiring/contracts";
import { managedRow } from "@/modules/jobs/service";
import { AppError } from "@/shared/errors/app-error";
import { reviewSchema, reviewQuerySchema, reputationDto, emptyFacts } from "./contracts";
import { getOwnerReputationFacts, getWorkerReputationFacts } from "./query";
import { visibleRecruitingWhere } from "@/modules/jobs/moderation";

type Side = "WORKER" | "EMPLOYER";
function reviewDto(row: Review, terms: unknown, completedAt: Date | null) {
  const snapshot = acceptedSnapshotSchema.parse(terms);
  const workerReview = row.direction === "WORKER_TO_EMPLOYER";
  return { id: row.id, direction: row.direction, rating: row.rating, comment: row.comment, createdAt: row.createdAt.toISOString(),
    reviewerDisplay: workerReview ? "Người lao động đã hoàn thành công việc" : snapshot.offer.owner.displayName,
    targetDisplay: workerReview ? snapshot.offer.owner.displayName : snapshot.worker.displayName,
    jobTitle: snapshot.offer.job.title, completedAt: completedAt?.toISOString() ?? null };
}
export async function submitReview(db: PrismaClient, actor: Principal, side: Side, engagementId: string, raw: unknown) {
  parse(opaqueId, engagementId); const input = parse(reviewSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, side, true, true);
    const engagement = await lockReviewEngagement(tx, actor, side, engagementId);
    if (engagement.status !== "COMPLETED") throw new AppError("CONFLICT");
    const direction = side === "WORKER" ? "WORKER_TO_EMPLOYER" : "EMPLOYER_TO_WORKER";
    const existing = await tx.review.findUnique({ where: { engagementId_direction: { engagementId, direction } } });
    if (existing) {
      // Replay remains actor-bound, even when another manager owns the same slot.
      if (existing.hiddenAt || existing.reviewerUserId !== actor.id || existing.creationKey !== input.creationKey || existing.rating !== input.rating || existing.comment !== input.comment) throw new AppError("CONFLICT");
      return reviewDto(existing, engagement.terms, engagement.completedAt);
    }
    const row = await tx.review.create({ data: { ...input, engagementId, direction, reviewerUserId: actor.id,
      workerProfileId: engagement.workerProfileId, companyId: engagement.job.companyId,
      employerProfileId: engagement.job.companyId ? null : engagement.job.employerProfileId } });
    return reviewDto(row, engagement.terms, engagement.completedAt);
  });
}
export async function getEngagementReviews(db: PrismaClient, actor: Principal, side: Side, engagementId: string) {
  parse(opaqueId, engagementId);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, side, false, true);
    if (user.status === "BANNED") throw new AppError("FORBIDDEN");
    const e = await lockReviewEngagement(tx, actor, side, engagementId);
    const rows = await tx.review.findMany({ where: { engagementId, hiddenAt: null }, orderBy: { direction: "asc" } });
    return { items: rows.map((row) => reviewDto(row, e.terms, e.completedAt)), canSubmit: user.status === "ACTIVE" && e.status === "COMPLETED"
      && !await tx.review.count({ where: { engagementId, direction: side === "WORKER" ? "WORKER_TO_EMPLOYER" : "EMPLOYER_TO_WORKER" } }) };
  });
}
async function reviewList(tx: Prisma.TransactionClient, where: Prisma.ReviewWhereInput, raw: unknown) {
  const query = parse(reviewQuerySchema, raw);
  const scope = { ...where, hiddenAt: null, engagement: { status: "COMPLETED" as const } };
  // Cursor UUID identifies a server-owned position within this target/direction.
  const cursor = query.cursor ? await tx.review.findFirst({ where: { ...scope, id: query.cursor }, select: { createdAt: true, id: true } }) : null;
  if (query.cursor && !cursor) throw new AppError("VALIDATION");
  const rows = await tx.review.findMany({ where: { ...scope, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    include: { engagement: { select: { terms: true, completedAt: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1 });
  const items = rows.slice(0, query.limit).map((row) => reviewDto(row, row.engagement.terms, row.engagement.completedAt));
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
}
export async function ownerReputationForPublicJob(db: PrismaClient, jobId: string) {
  parse(opaqueId, jobId);
  return db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { AND: [{ id: jobId, status: "PUBLISHED" }, visibleRecruitingWhere] }, select: { companyId: true, employerProfileId: true } });
    if (!job) throw new AppError("NOT_FOUND");
    const facts = await getOwnerReputationFacts(tx, job);
    return { rating: reputationDto(facts).rating, completedEngagementCount: facts.completed };
  });
}
export async function ownerReviewsForJob(db: PrismaClient, actor: Principal, jobId: string, raw: unknown) {
  parse(opaqueId, jobId); parse(reviewQuerySchema, raw);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "WORKER", false, true);
    if (user.status !== "ACTIVE") throw new AppError("FORBIDDEN");
    const job = await tx.job.findFirst({ where: { AND: [{ id: jobId, status: "PUBLISHED" }, visibleRecruitingWhere] }, select: { companyId: true, employerProfileId: true } });
    if (!job) throw new AppError("NOT_FOUND");
    return reviewList(tx, { ...(job.companyId ? { companyId: job.companyId } : { companyId: null, employerProfileId: job.employerProfileId }), direction: "WORKER_TO_EMPLOYER" }, raw);
  });
}
export async function workerReviewsForEmployer(db: PrismaClient, actor: Principal, workerId: string, raw: unknown, applicationId?: string) {
  parse(opaqueId, workerId); parse(reviewQuerySchema, raw); if (applicationId) parse(opaqueId, applicationId);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    const profile = await requireEmployerProfile(tx, actor.id);
    if (applicationId) {
      const app = await tx.application.findFirst({ where: { id: applicationId, workerProfileId: workerId }, select: { jobId: true } });
      if (!app) throw new AppError("NOT_FOUND");
      await managedRow(tx, actor, profile.id, app.jobId, true);
    } else if (!await tx.workerProfile.findFirst({ where: { id: workerId, discoverable: true, user: { status: "ACTIVE", roles: { some: { role: "WORKER" } } } }, select: { id: true } })) throw new AppError("NOT_FOUND");
    const facts = (await getWorkerReputationFacts(tx, [workerId])).get(workerId) ?? emptyFacts();
    return { reputation: reputationDto(facts), ...await reviewList(tx, { workerProfileId: workerId, direction: "EMPLOYER_TO_WORKER" }, raw) };
  });
}
