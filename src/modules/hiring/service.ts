import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { requireEmployerProfile, requireWorkerProfile } from "@/modules/profiles/access";
import { discoveryWorkerDto, selfWorkerDto, workerSelect } from "@/modules/profiles/service";
import { opaqueId, parse } from "@/modules/profiles/contracts";
import { managedRow } from "@/modules/jobs/service";
import { inputFromRow, jobSelect, type JobRow } from "@/modules/jobs/projection";
import { AppError } from "@/shared/errors/app-error";
import { acceptedSnapshotSchema, applySchema, cancellationSchema, emptySchema, hiringQuerySchema, offerSchema, snapshotSchema,
  type ApplicationAction, type EngagementAction, type OfferAction } from "./contracts";
import { activeStatuses, applicationTransition, engagementTransition, expired, occupiedStatuses, requireCapacity, requireEligibility, requirePending } from "./policy";
import { applicationDto, applicationSelect, offerDto, offerSelect } from "./projection";
import { matchWorkerJob } from "@/modules/matching/algorithm";
import { getWorkerReputationFacts } from "@/modules/reviews/query";

type Tx = Prisma.TransactionClient;
type Side = "WORKER" | "EMPLOYER";
async function serverNow(tx: Tx) {
  // Prisma's raw adapter maps PostgreSQL timestamp fields to UTC Date values.
  // Make the UTC wall time explicit, independent of the database session timezone.
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  return row.now;
}
async function workerJob(tx: Tx, id: string): Promise<JobRow> {
  const scope = await tx.job.findUnique({ where: { id }, select: { companyId: true, employerProfileId: true } });
  if (!scope) throw new AppError("NOT_FOUND");
  if (scope.companyId) await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${scope.companyId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "EmployerProfile" WHERE "id" = ${scope.employerProfileId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
  return tx.job.findUniqueOrThrow({ where: { id }, select: jobSelect });
}
async function noSelfApply(tx: Tx, actor: Principal, job: JobRow) {
  const self = job.companyId
    ? await tx.companyMember.findUnique({ where: { companyId_userId: { companyId: job.companyId, userId: actor.id } }, select: { role: true } })
    : await tx.employerProfile.findFirst({ where: { id: job.employerProfileId, userId: actor.id }, select: { id: true } });
  if (self) throw new AppError("FORBIDDEN");
}
async function eligibleWorker(tx: Tx, actor: Principal, name: string, job: JobRow) {
  const worker = await tx.workerProfile.findUnique({ where: { userId: actor.id }, select: workerSelect });
  if (!worker) throw new AppError("FORBIDDEN");
  await noSelfApply(tx, actor, job);
  requireEligibility(name, selfWorkerDto(worker), inputFromRow(job));
  return worker;
}
async function scopeApplication(tx: Tx, actor: Principal, side: Side, id: string) {
  const initial = await tx.application.findUnique({ where: { id }, select: { jobId: true, workerProfileId: true } });
  if (!initial) throw new AppError("NOT_FOUND");
  let job: JobRow;
  if (side === "WORKER") {
    const worker = await requireWorkerProfile(tx, actor.id);
    if (initial.workerProfileId !== worker.id) throw new AppError("NOT_FOUND");
    job = await workerJob(tx, initial.jobId);
  } else {
    const employer = await requireEmployerProfile(tx, actor.id);
    job = await managedRow(tx, actor, employer.id, initial.jobId, true);
  }
  await tx.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${id} FOR UPDATE`;
  const application = await tx.application.findUniqueOrThrow({ where: { id }, include: { engagement: { select: { id: true } } } });
  return { job, application };
}
async function normalizeExpiry(tx: Tx, applicationId: string, now: Date) {
  await tx.$queryRaw`SELECT "id" FROM "Offer" WHERE "applicationId" = ${applicationId} AND "status" = 'PENDING' FOR UPDATE`;
  const result = await tx.offer.updateMany({ where: { applicationId, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", resolvedAt: now } });
  if (result.count) await tx.application.updateMany({ where: { id: applicationId, status: "OFFERED", engagement: null }, data: { status: "SHORTLISTED" } });
}
async function detail(tx: Tx, id: string, side: Side) {
  const row = await tx.application.findUniqueOrThrow({ where: { id }, select: applicationSelect });
  const dto = applicationDto(row);
  if (side === "WORKER") return { ...dto, worker: null };
  const relation = await tx.application.findUniqueOrThrow({ where: { id }, select: { worker: { select: workerSelect } } });
  return { ...dto, worker: { ...discoveryWorkerDto(relation.worker), completeness: selfWorkerDto(relation.worker).completeness } };
}
export async function applyToJob(db: PrismaClient, actor: Principal, jobId: string, raw: unknown) {
  parse(opaqueId, jobId); const { creationKey } = parse(applySchema, raw);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "WORKER", true, true);
    if (!user.emailVerified) throw new AppError("FORBIDDEN");
    const job = await workerJob(tx, jobId);
    const worker = await eligibleWorker(tx, actor, user.name, job);
    const previous = await tx.application.findUnique({ where: { jobId_workerProfileId: { jobId, workerProfileId: worker.id } } });
    if (previous) {
      if (previous.creationKey !== creationKey) throw new AppError("CONFLICT");
      return detail(tx, previous.id, "WORKER");
    }
    if (job.status !== "PUBLISHED") throw new AppError("CONFLICT");
    requireCapacity(await tx.engagement.count({ where: { jobId, status: { in: occupiedStatuses } } }), job.headcount);
    const facts = (await getWorkerReputationFacts(tx, [worker.id])).get(worker.id)!;
    const match = matchWorkerJob(selfWorkerDto(worker), user.name, inputFromRow(job), job.status, await serverNow(tx), undefined, facts);
    const row = await tx.application.create({ data: { jobId, workerProfileId: worker.id, creationKey,
      matchEligibleAtApply: match.eligible, matchScoreAtApply: match.score, matchCoverageAtApply: match.coverage,
      matchWeightsVersion: match.weightsVersion, matchAlgorithmVersion: match.algorithmVersion, matchedAt: new Date(match.computedAt) } });
    return detail(tx, row.id, "WORKER");
  });
}
export async function getApplication(db: PrismaClient, actor: Principal, side: Side, id: string) {
  parse(opaqueId, id);
  // Detail reads normalize expiry, never mark applications VIEWED.
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, side, false, true);
    await scopeApplication(tx, actor, side, id);
    await normalizeExpiry(tx, id, await serverNow(tx));
    return detail(tx, id, side);
  });
}
export async function listApplications(db: PrismaClient, actor: Principal, side: Side, raw: unknown, jobId?: string) {
  const query = parse(hiringQuerySchema, raw); if (jobId) parse(opaqueId, jobId);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, side, false, true);
    let where: Prisma.ApplicationWhereInput;
    if (side === "WORKER") where = { workerProfileId: (await requireWorkerProfile(tx, actor.id)).id };
    else {
      if (!jobId) throw new AppError("VALIDATION");
      await managedRow(tx, actor, (await requireEmployerProfile(tx, actor.id)).id, jobId, true);
      where = { jobId };
    }
    const now = await serverNow(tx);
    const overdue = { offers: { some: { status: "PENDING" as const, expiresAt: { lte: now } } } };
    const statusFilter: Prisma.ApplicationWhereInput = query.status === "SHORTLISTED"
      ? { OR: [{ status: "SHORTLISTED" }, { status: "OFFERED", ...overdue }] }
      : query.status === "OFFERED" ? { status: "OFFERED", NOT: overdue } : query.status ? { status: query.status } : {};
    const rows = await tx.application.findMany({ where: { ...where, ...statusFilter, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      select: { ...applicationSelect, worker: { select: workerSelect } }, orderBy: { id: "asc" }, take: query.limit + 1 });
    // Lists project overdue offers as EXPIRED without mutating/reordering pipeline.
    // Detail/action touch persists normalization under canonical locks.
    const page = rows.slice(0, query.limit).map((row) => {
      const dto = applicationDto(row);
      if (dto.offer?.status === "PENDING" && expired(row.offers[0].expiresAt, now)) {
        dto.offer.status = "EXPIRED";
        if (dto.status === "OFFERED") dto.status = "SHORTLISTED";
      }
      return { ...dto, worker: side === "EMPLOYER" ? { ...discoveryWorkerDto(row.worker), completeness: selfWorkerDto(row.worker).completeness } : null };
    });
    return { items: page, nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
export async function getApplyState(db: PrismaClient, actor: Principal, jobId: string) {
  parse(opaqueId, jobId);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "WORKER", true, true);
    const worker = await requireWorkerProfile(tx, actor.id);
    const previous = await tx.application.findUnique({ where: { jobId_workerProfileId: { jobId, workerProfileId: worker.id } }, select: { id: true } });
    if (previous) return { applicationId: previous.id, eligible: false };
    if (!user.emailVerified) return { applicationId: null, eligible: false };
    const job = await workerJob(tx, jobId);
    await eligibleWorker(tx, actor, user.name, job);
    const occupied = await tx.engagement.count({ where: { jobId, status: { in: occupiedStatuses } } });
    return { applicationId: null, eligible: job.status === "PUBLISHED" && occupied < job.headcount };
  });
}
export async function listOffers(db: PrismaClient, actor: Principal, side: Side, applicationId: string, raw: unknown) {
  parse(opaqueId, applicationId); const query = parse(hiringQuerySchema.omit({ status: true }), raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, side, false, true);
    await scopeApplication(tx, actor, side, applicationId);
    await normalizeExpiry(tx, applicationId, await serverNow(tx));
    const rows = await tx.offer.findMany({ where: { applicationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) }, select: offerSelect, orderBy: { id: "asc" }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(offerDto), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
export async function actOnApplication(db: PrismaClient, actor: Principal, id: string, action: ApplicationAction, raw: unknown) {
  parse(opaqueId, id); parse(emptySchema, raw);
  const side = action === "withdraw" ? "WORKER" : "EMPLOYER";
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, side, side === "EMPLOYER", true);
    const { application } = await scopeApplication(tx, actor, side, id);
    const now = await serverNow(tx); await normalizeExpiry(tx, id, now);
    const fresh = await tx.application.findUniqueOrThrow({ where: { id } });
    const pending = await tx.offer.count({ where: { applicationId: id, status: "PENDING" } });
    const status = applicationTransition(fresh.status, action, Boolean(application.engagement), pending > 0);
    if (status === "WITHDRAWN") await tx.offer.updateMany({ where: { applicationId: id, status: "PENDING" }, data: { status: "REVOKED", resolvedAt: now } });
    const timestamp = { VIEWED: "viewedAt", SHORTLISTED: "shortlistedAt", REJECTED: "rejectedAt", WITHDRAWN: "withdrawnAt" }[status as "VIEWED" | "SHORTLISTED" | "REJECTED" | "WITHDRAWN"];
    if (fresh.status !== status) await tx.application.update({ where: { id }, data: { status, [timestamp]: now } });
    return detail(tx, id, side);
  });
}
export async function createOffer(db: PrismaClient, actor: Principal, applicationId: string, raw: unknown) {
  parse(opaqueId, applicationId); const input = parse(offerSchema, raw);
  const result = await db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "EMPLOYER", true, true);
    if (!user.emailVerified) throw new AppError("FORBIDDEN");
    const { job, application } = await scopeApplication(tx, actor, "EMPLOYER", applicationId);
    const now = await serverNow(tx); await normalizeExpiry(tx, applicationId, now);
    const previous = await tx.offer.findUnique({ where: { applicationId_creationKey: { applicationId, creationKey: input.creationKey } }, select: offerSelect });
    if (previous) {
      const snapshot = snapshotSchema.parse(previous.terms);
      if (snapshot.expiresAt !== input.expiresAt || (input.compensationMin !== undefined && (snapshot.job.compensationMin !== input.compensationMin || snapshot.job.compensationMax !== input.compensationMax))) throw new AppError("CONFLICT");
      return { offer: offerDto(previous) };
    }
    const fresh = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
    if (!["PUBLISHED", "PAUSED"].includes(job.status) || fresh.status !== "SHORTLISTED" || application.engagement || await tx.offer.count({ where: { applicationId, status: "PENDING" } })) return { conflict: true as const };
    if (input.expiresAt && new Date(input.expiresAt) <= now) return { conflict: true as const };
    const terms = snapshotSchema.parse({ schemaVersion: 1, jobId: job.id, jobVersion: job.version, ownerId: job.companyId ?? job.employerProfileId,
      owner: job.company ? { kind: "COMPANY", displayName: job.company.name, companySlug: job.company.slug, verification: job.company.verification }
        : { kind: "PERSONAL", displayName: job.employer.user.name, companySlug: null, verification: null },
      job: { ...inputFromRow(job), ...(input.compensationMin !== undefined ? { compensationMin: input.compensationMin, compensationMax: input.compensationMax } : {}) },
      createdAt: now.toISOString(), expiresAt: input.expiresAt });
    const latest = await tx.offer.aggregate({ where: { applicationId }, _max: { revision: true } });
    const offer = await tx.offer.create({ data: { applicationId, jobId: job.id, creationKey: input.creationKey, revision: (latest._max.revision ?? 0) + 1,
      terms, createdAt: now, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }, select: offerSelect });
    await tx.application.update({ where: { id: applicationId }, data: { status: "OFFERED", offeredAt: now } });
    return { offer: offerDto(offer) };
  });
  if (!("offer" in result) || !result.offer) throw new AppError("CONFLICT");
  return result.offer;
}
export async function actOnOffer(db: PrismaClient, actor: Principal, id: string, action: OfferAction, raw: unknown) {
  parse(opaqueId, id); parse(emptySchema, raw);
  const result = await db.$transaction(async (tx) => {
    const side = action === "revoke" ? "EMPLOYER" : "WORKER";
    const user = await currentActor(tx, actor, side, action === "accept", true);
    const initial = await tx.offer.findUnique({ where: { id }, select: { applicationId: true } });
    if (!initial) throw new AppError("NOT_FOUND");
    const { job, application } = await scopeApplication(tx, actor, side, initial.applicationId);
    const now = await serverNow(tx); await normalizeExpiry(tx, application.id, now);
    await tx.$queryRaw`SELECT "id" FROM "Offer" WHERE "id" = ${id} FOR UPDATE`;
    const offer = await tx.offer.findUniqueOrThrow({ where: { id } });
    if (action === "accept" && offer.status === "ACCEPTED" && application.engagement) return { application: await detail(tx, application.id, side) };
    if (offer.status !== "PENDING" || application.engagement) return { conflict: true as const };
    requirePending(offer.status);
    if (action === "accept") {
      if (!user.emailVerified) throw new AppError("FORBIDDEN");
      const worker = await eligibleWorker(tx, actor, user.name, job);
      if (!["PUBLISHED", "PAUSED", "CLOSED"].includes(job.status) || application.status !== "OFFERED") return { conflict: true as const };
      requireCapacity(await tx.engagement.count({ where: { jobId: job.id, status: { in: occupiedStatuses } } }), job.headcount);
      const terms = acceptedSnapshotSchema.parse({ schemaVersion: 1, offer: snapshotSchema.parse(offer.terms), worker: { displayName: user.name, headline: worker.headline }, acceptedAt: now.toISOString() });
      await tx.offer.update({ where: { id }, data: { status: "ACCEPTED", resolvedAt: now } });
      await tx.application.update({ where: { id: application.id }, data: { status: "ACCEPTED", acceptedAt: now } });
      await tx.engagement.create({ data: { applicationId: application.id, acceptedOfferId: id, jobId: job.id, workerProfileId: worker.id, terms, acceptedAt: now } });
    } else {
      await tx.offer.update({ where: { id }, data: { status: action === "decline" ? "DECLINED" : "REVOKED", resolvedAt: now } });
      await tx.application.updateMany({ where: { id: application.id, status: "OFFERED", engagement: null }, data: { status: "SHORTLISTED" } });
    }
    return { application: await detail(tx, application.id, side) };
  });
  if (!("application" in result) || !result.application) throw new AppError("CONFLICT");
  return result.application;
}
export async function actOnEngagement(db: PrismaClient, actor: Principal, side: Side, id: string, action: EngagementAction, raw: unknown) {
  parse(opaqueId, id);
  const cancellation = action === "cancel" ? parse(cancellationSchema, raw) : (parse(emptySchema, raw), null);
  if ((action === "request-completion" && side !== "WORKER") || (["start", "confirm-completion"].includes(action) && side !== "EMPLOYER")) throw new AppError("FORBIDDEN");
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, side, false, true);
    // D5 banned-account exceptions remain deferred; suspended parties retain only active obligations.
    if (user.status === "BANNED") throw new AppError("FORBIDDEN");
    const initial = await tx.engagement.findUnique({ where: { id }, select: { applicationId: true } });
    if (!initial) throw new AppError("NOT_FOUND");
    const { application } = await scopeApplication(tx, actor, side, initial.applicationId);
    const acceptedOffer = await tx.engagement.findUniqueOrThrow({ where: { id }, select: { acceptedOfferId: true } });
    await tx.$queryRaw`SELECT "id" FROM "Offer" WHERE "id" = ${acceptedOffer.acceptedOfferId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Engagement" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.engagement.findUniqueOrThrow({ where: { id } });
    if (user.status === "SUSPENDED" && !activeStatuses.includes(row.status as typeof activeStatuses[number])) throw new AppError("FORBIDDEN");
    const status = engagementTransition(row.status, action, Boolean(row.completionRequestedAt));
    const now = await serverNow(tx);
    if (status !== row.status || action === "request-completion") await tx.engagement.update({ where: { id }, data: { status,
      ...(action === "start" ? { startedAt: row.startedAt ?? now } : {}),
      ...(action === "request-completion" ? { completionRequestedAt: row.completionRequestedAt ?? now } : {}),
      ...(action === "confirm-completion" ? { completedAt: row.completedAt ?? now } : {}),
      ...(cancellation ? { cancelledAt: now, cancelledBy: actor.id, cancellationCategory: cancellation.category, cancellationReason: cancellation.reason } : {}) } });
    return detail(tx, application.id, side);
  });
}
