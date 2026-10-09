import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { requireEmployerProfile } from "@/modules/profiles/access";
import { requireCompanyMembership } from "@/modules/companies/service";
import { opaqueId, parse } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { createJobSchema, duplicateSchema, FREE_ACTIVE_LIMIT, managementQuerySchema, transitionSchema, updateJobSchema,
  type JobAction, type JobInput, type Quota } from "./contracts";
import { classifyJobEdit, duplicateTerms, isActive, nextStatus, ownsJob, permitsRestrictedActor, requireEditableTerms, requirePublishable, requireQuota } from "./policy";
import { inputFromRow, jobSelect, managedJobDto, publicJobDto } from "./projection";
import { hiringEditContext, finishRecruitment } from "@/modules/hiring/job-query";
import { searchPublicJobs } from "./search";
import { requireRecruitingVisible, visibleRecruitingWhere } from "./moderation";

async function lockOwner(tx: Prisma.TransactionClient, actor: Principal, profileId: string, companyId: string | null) {
  if (companyId) {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
    await requireCompanyMembership(tx, actor.id, companyId);
  } else await tx.$queryRaw`SELECT "id" FROM "EmployerProfile" WHERE "id" = ${profileId} FOR UPDATE`;
}
export async function managedRow(tx: Prisma.TransactionClient, actor: Principal, profileId: string, id: string, lock: boolean) {
  const scope = await tx.job.findUnique({ where: { id }, select: { employerProfileId: true, companyId: true } });
  if (!scope) throw new AppError("NOT_FOUND");
  if (!scope.companyId && !ownsJob(profileId, scope, false)) throw new AppError("NOT_FOUND");
  if (lock) await lockOwner(tx, actor, scope.employerProfileId, scope.companyId);
  else if (scope.companyId) await requireCompanyMembership(tx, actor.id, scope.companyId);
  if (lock) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
  const row = await tx.job.findUnique({ where: { id }, select: jobSelect });
  if (!row || row.companyId !== scope.companyId || row.employerProfileId !== scope.employerProfileId) throw new AppError("NOT_FOUND");
  return row;
}
async function quotaFor(tx: Prisma.TransactionClient, owner: { employerProfileId: string; companyId: string | null }): Promise<Quota> {
  const active = await tx.job.count({ where: { ...(owner.companyId ? { companyId: owner.companyId } : { companyId: null, employerProfileId: owner.employerProfileId }), status: { in: ["PUBLISHED", "PAUSED"] } } });
  return { scope: owner.companyId ? "COMPANY" : "PERSONAL", active, limit: FREE_ACTIVE_LIMIT };
}
function scalarData(input: JobInput) {
  return { title: input.title, description: input.description, category: input.category, employmentType: input.employmentType,
    workMode: input.workMode, city: input.city || null, compensationType: input.compensationType,
    compensationMin: input.compensationMin === null ? null : BigInt(input.compensationMin),
    compensationMax: input.compensationMax === null ? null : BigInt(input.compensationMax), currency: input.currency,
    headcount: input.headcount, startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null,
    endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null, timezone: input.timezone };
}
async function requireActiveSkills(tx: Prisma.TransactionClient, input: JobInput) {
  const count = await tx.skill.count({ where: { id: { in: input.skills.map((item) => item.skillId) }, active: true } });
  if (count !== input.skills.length) throw new AppError("VALIDATION");
}
async function createDraft(tx: Prisma.TransactionClient, actor: Principal, profileId: string, companyId: string | null, key: string, input: JobInput) {
  await requireActiveSkills(tx, input);
  const previous = await tx.job.findUnique({ where: { createdByUserId_creationKey: { createdByUserId: actor.id, creationKey: key } }, select: jobSelect });
  if (previous) {
    // A replay never gains authority from creator provenance or changes ownership.
    if (previous.companyId !== companyId || (!companyId && previous.employerProfileId !== profileId)) throw new AppError("CONFLICT");
    const changes = classifyJobEdit(inputFromRow(previous), input);
    if (changes.material.length || changes.nonMaterial.length) throw new AppError("CONFLICT");
    return previous;
  }
  return tx.job.create({ data: { ...scalarData(input), companyId, employerProfileId: profileId, createdByUserId: actor.id, creationKey: key,
    skills: { create: input.skills }, schedule: { create: input.schedule } }, select: jobSelect });
}
export async function createJob(db: PrismaClient, actor: Principal, raw: unknown) {
  const { companyId, creationKey, ...input } = parse(createJobSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    const profile = await requireEmployerProfile(tx, actor.id);
    await lockOwner(tx, actor, profile.id, companyId);
    const row = await createDraft(tx, actor, profile.id, companyId, creationKey, input);
    return managedJobDto(row, await quotaFor(tx, row));
  });
}
export async function getManagedJob(db: PrismaClient, actor: Principal, id: string) {
  parse(opaqueId, id);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER"); const profile = await requireEmployerProfile(tx, actor.id);
    const row = await managedRow(tx, actor, profile.id, id, false);
    return managedJobDto(row, await quotaFor(tx, row));
  });
}
export async function editJob(db: PrismaClient, actor: Principal, id: string, raw: unknown) {
  parse(opaqueId, id); const { expectedVersion, ...input } = parse(updateJobSchema, raw);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "EMPLOYER", true, true); const profile = await requireEmployerProfile(tx, actor.id);
    const row = await managedRow(tx, actor, profile.id, id, true);
    if (row.version !== expectedVersion || !["DRAFT", "PUBLISHED", "PAUSED"].includes(row.status)) throw new AppError("CONFLICT");
    requireEditableTerms(inputFromRow(row), input, await hiringEditContext(tx, id));
    await requireActiveSkills(tx, input);
    if (isActive(row.status)) { if (!user.emailVerified) throw new AppError("FORBIDDEN"); requirePublishable(input); }
    await tx.jobSkill.deleteMany({ where: { jobId: id } }); await tx.jobScheduleWindow.deleteMany({ where: { jobId: id } });
    const updated = await tx.job.update({ where: { id }, data: { ...scalarData(input), version: { increment: 1 },
      skills: { create: input.skills }, schedule: { create: input.schedule } }, select: jobSelect });
    return managedJobDto(updated, await quotaFor(tx, updated));
  });
}
export async function transitionJob(db: PrismaClient, actor: Principal, id: string, action: JobAction, raw: unknown) {
  parse(opaqueId, id); const { expectedVersion } = parse(transitionSchema, raw);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "EMPLOYER", !permitsRestrictedActor(action), true, permitsRestrictedActor(action) ? "reduce-job-exposure" : undefined);
    const profile = await requireEmployerProfile(tx, actor.id); const row = await managedRow(tx, actor, profile.id, id, true);
    if (row.version !== expectedVersion) throw new AppError("CONFLICT");
    const status = nextStatus(row.status, action);
    if (status === "PUBLISHED") {
      await requireRecruitingVisible(tx, id);
      if (!user.emailVerified) throw new AppError("FORBIDDEN");
      requirePublishable(inputFromRow(row), row.skills.every((item) => item.skill.active));
      requireQuota((await quotaFor(tx, row)).active, row.status);
    }
    const now = new Date();
    if (status === "CANCELLED" || status === "COMPLETED") await finishRecruitment(tx, id, status, now);
    const updated = await tx.job.update({ where: { id }, data: { status, version: { increment: 1 },
      ...(status === "PUBLISHED" && !row.publishedAt ? { publishedAt: now } : {}),
      ...(status === "CLOSED" ? { closedAt: now } : {}), ...(status === "CANCELLED" ? { cancelledAt: now } : {}) }, select: jobSelect });
    return managedJobDto(updated, await quotaFor(tx, updated));
  });
}
export async function duplicateJob(db: PrismaClient, actor: Principal, id: string, raw: unknown) {
  parse(opaqueId, id); const { creationKey } = parse(duplicateSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true); const profile = await requireEmployerProfile(tx, actor.id);
    const source = await managedRow(tx, actor, profile.id, id, true);
    const row = await createDraft(tx, actor, profile.id, source.companyId, creationKey, duplicateTerms(inputFromRow(source)));
    if (row.id === source.id) throw new AppError("CONFLICT");
    return managedJobDto(row, await quotaFor(tx, row));
  });
}
export async function listManagedJobs(db: PrismaClient, actor: Principal, raw: unknown) {
  const query = parse(managementQuerySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER"); const profile = await requireEmployerProfile(tx, actor.id);
    if (query.companyId) await requireCompanyMembership(tx, actor.id, query.companyId);
    const where: Prisma.JobWhereInput = { OR: [{ companyId: null, employerProfileId: profile.id }, { company: { members: { some: { userId: actor.id } } } }],
      ...(query.companyId ? { companyId: query.companyId } : {}), ...(query.personal ? { companyId: null } : {}),
      ...(query.status ? { status: query.status } : {}), ...(query.cursor ? { id: { gt: query.cursor } } : {}) };
    const rows = await tx.job.findMany({ where, select: jobSelect, orderBy: { id: "asc" }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    // Bounded owner grouping, no per-row quota queries and no creator-scoped company counts.
    const companyIds = [...new Set(page.flatMap((row) => row.companyId ? [row.companyId] : []))];
    // An interactive transaction uses one pg connection: sequence its queries.
    const personalCount = await tx.job.count({ where: { employerProfileId: profile.id, companyId: null, status: { in: ["PUBLISHED", "PAUSED"] } } });
    const companyCounts = await tx.job.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds }, status: { in: ["PUBLISHED", "PAUSED"] } }, _count: { _all: true } });
    const counts = new Map(companyCounts.map((count) => [count.companyId, count._count._all]));
    return { items: page.map((row) => managedJobDto(row, { scope: row.companyId ? "COMPANY" : "PERSONAL", active: row.companyId ? counts.get(row.companyId) ?? 0 : personalCount, limit: FREE_ACTIVE_LIMIT })),
      personalQuota: { scope: "PERSONAL" as const, active: personalCount, limit: FREE_ACTIVE_LIMIT }, nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
export async function listPublicJobs(db: PrismaClient, raw: unknown) {
  return searchPublicJobs(db, raw);
}
export async function getPublicJob(db: PrismaClient, id: string) {
  parse(opaqueId, id);
  const row = await db.job.findFirst({ where: { AND: [{ id, status: "PUBLISHED" }, visibleRecruitingWhere] }, select: jobSelect });
  if (!row) throw new AppError("NOT_FOUND");
  return publicJobDto(row);
}
