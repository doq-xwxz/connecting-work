import "server-only";
import type { Prisma, PrismaClient, AuditAction, ModerationCase, Report, ReportReason } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { lockModerationAccountScopes, moderateAccount } from "@/modules/auth/moderation";
import { lockModerationJob, moderateJob } from "@/modules/jobs/moderation";
import { lockModerationEngagement, forceEngagement } from "@/modules/hiring/moderation";
import { lockModerationReview, moderateReview } from "@/modules/reviews/moderation";
import { moderationMessageContext } from "@/modules/messaging/moderation";
import { lockChatApplication } from "@/modules/hiring/chat-query";
import { opaqueId, parse } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { logger } from "@/shared/logging/logger";
import { authorizeReportTarget } from "./report-target";
import { actionSchema, actionTarget, attachSchema, casesQuerySchema, closeSchema, createCaseSchema, reasonSchema, reportSchema,
  reportsQuerySchema, reportDetailsSchema, reportContextSchema, requireBinding, requireOpenCase, targetSchema, timelineSchema, type ModerationAction, type Target } from "./contracts";

type Tx = Prisma.TransactionClient;
async function clock(tx: Tx) { return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`)[0].now; }
async function reporter(tx: Tx, actor: Principal) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR NO KEY UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true, status: true, roles: { select: { role: true } } } });
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (user.status === "BANNED" || !user.roles.some(({ role }) => role === "WORKER" || role === "EMPLOYER")) throw new AppError("FORBIDDEN");
  return { ...actor, name: user.name, status: user.status, roles: user.roles.map(({ role }) => role) };
}
function receipt(row: Report) { return { id: row.id, targetType: row.targetType, targetId: row.targetType === "USER" ? null : row.targetId,
  targetSummary: row.targetType, reasonCode: row.reasonCode, status: row.status, createdAt: row.createdAt.toISOString() }; }
function caseDto(row: ModerationCase) { return { id: row.id, targetType: row.targetType, targetId: row.targetId, status: row.status, severity: row.severity,
  createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, resolutionCode: row.resolutionCode, resolutionNote: row.resolutionNote }; }
const actionNames: Record<ModerationAction, AuditAction> = { "hide-job": "JOB_HIDDEN", "unhide-job": "JOB_UNHIDDEN", "hide-review": "REVIEW_HIDDEN", "unhide-review": "REVIEW_UNHIDDEN",
  suspend: "USER_SUSPENDED", unsuspend: "USER_UNSUSPENDED", ban: "USER_BANNED", "force-complete": "ENGAGEMENT_FORCE_COMPLETED", "force-cancel": "ENGAGEMENT_FORCE_CANCELLED" };
async function audit(tx: Tx, actor: Principal, c: ModerationCase, action: AuditAction, input: { reason: string; reasonCode: ReportReason }, metadata: Prisma.InputJsonObject = {}) {
  const createdAt = await clock(tx);
  return tx.auditEvent.create({ data: { adminUserId: actor.id, caseId: c.id, resourceType: c.targetType, resourceId: c.targetId, action, ...input, metadata, createdAt } });
}
async function lockedCase(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "ModerationCase" WHERE id=${id} FOR UPDATE`;
  const c = await tx.moderationCase.findUnique({ where: { id } });
  if (!c) throw new AppError("NOT_FOUND");
  return c;
}
async function targetExists(tx: Tx, type: Target, id: string) {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT moderation_target_exists(${type}::"ModerationTarget",${id}) AS ok`;
  if (!row.ok) throw new AppError("NOT_FOUND");
}
export async function createReport(db: PrismaClient, actor: Principal, raw: unknown) {
  const input = parse(reportSchema, raw);
  return db.$transaction(async (tx) => {
    const fresh = await reporter(tx, actor);
    await authorizeReportTarget(tx, fresh, input.targetType, input.targetId);
    const existing = await tx.report.findFirst({ where: { reporterUserId: actor.id, targetType: input.targetType, targetId: input.targetId, status: { in: ["OPEN", "IN_REVIEW"] } } });
    if (existing) return receipt(existing);
    const now = await clock(tx), key = `report:user:${actor.id}`;
    const bucket = await tx.rateLimit.findUnique({ where: { key } });
    const sameWindow = bucket && now.getTime() - Number(bucket.lastRequest) < 3600000;
    if (sameWindow && bucket.count >= 10) throw new AppError("RATE_LIMITED");
    await tx.rateLimit.upsert({ where: { key }, create: { id: crypto.randomUUID(), key, count: 1, lastRequest: BigInt(now.getTime()) },
      update: sameWindow ? { count: { increment: 1 } } : { count: 1, lastRequest: BigInt(now.getTime()) } });
    return receipt(await tx.report.create({ data: { ...input, reporterUserId: actor.id, createdAt: now } }));
  });
}
async function counterpartyTarget(tx: Tx, actor: Principal, raw: unknown) {
  const input = parse(reportContextSchema, raw), fresh = await reporter(tx, actor);
  if (fresh.status !== "ACTIVE" || !fresh.roles.includes(input.side)) throw new AppError("FORBIDDEN");
  const context = await lockChatApplication(tx, fresh, input.side, input.applicationId);
  return input.side === "EMPLOYER" ? { targetType: "USER" as const, targetId: context.worker.userId }
    : context.job.companyId ? { targetType: "COMPANY" as const, targetId: context.job.companyId }
    : { targetType: "USER" as const, targetId: context.job.employer.userId };
}
export async function reportCounterpartyTarget(db: PrismaClient, actor: Principal, raw: unknown) {
  return db.$transaction(async (tx) => { const target = await counterpartyTarget(tx, actor, raw); return { targetType: target.targetType }; });
}
export async function reportCounterparty(db: PrismaClient, actor: Principal, context: unknown, raw: unknown) {
  const details = parse(reportDetailsSchema, raw);
  const target = await db.$transaction((tx) => counterpartyTarget(tx, actor, context));
  // The normal report transaction rechecks fresh status, relationship and membership.
  return createReport(db, actor, { ...target, ...details });
}
export async function listOwnReports(db: PrismaClient, actor: Principal, raw: unknown) {
  const q = parse(reportsQuerySchema, raw);
  return db.$transaction(async (tx) => {
    await reporter(tx, actor);
    const rows = await tx.report.findMany({ where: { reporterUserId: actor.id, ...(q.status ? { status: q.status } : {}), ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return { items: page.map(receipt), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  });
}
export async function reportFormTarget(db: PrismaClient, actor: Principal, raw: unknown) {
  const input = parse(targetSchema, raw);
  return db.$transaction(async (tx) => { const fresh = await reporter(tx, actor); await authorizeReportTarget(tx, fresh, input.targetType, input.targetId); return { targetType: input.targetType }; });
}
export async function listAdminReports(db: PrismaClient, actor: Principal, raw: unknown) {
  const q = parse(reportsQuerySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const rows = await tx.report.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.cursor ? { id: { gt: q.cursor } } : {}) },
      select: { id: true, targetType: true, targetId: true, reasonCode: true, status: true, createdAt: true, cases: { select: { caseId: true } } }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return { items: page.map(({ cases, createdAt, ...row }) => ({ ...row, createdAt: createdAt.toISOString(), caseId: cases[0]?.caseId ?? null })), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  });
}
export async function listCases(db: PrismaClient, actor: Principal, raw: unknown) {
  const q = parse(casesQuerySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const rows = await tx.moderationCase.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}), ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return { items: page.map(caseDto), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  });
}
async function attach(tx: Tx, actor: Principal, c: ModerationCase, reportId: string, input: { reason: string; reasonCode: Parameters<typeof audit>[4]["reasonCode"] }) {
  requireOpenCase(c.status);
  await tx.$queryRaw`SELECT id FROM "Report" WHERE id=${reportId} FOR UPDATE`;
  const r = await tx.report.findUnique({ where: { id: reportId }, include: { cases: true } });
  if (!r) throw new AppError("NOT_FOUND");
  requireBinding(c.targetType, c.targetId, r.targetType, r.targetId);
  if (r.status !== "OPEN" || r.cases.length) throw new AppError("CONFLICT");
  await tx.caseReport.create({ data: { caseId: c.id, reportId } });
  await tx.report.update({ where: { id: reportId }, data: { status: "IN_REVIEW" } });
  await audit(tx, actor, c, "REPORT_ATTACHED", input, { reportId });
}
export async function createCase(db: PrismaClient, actor: Principal, raw: unknown) {
  const input = parse(createCaseSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    await targetExists(tx, input.targetType, input.targetId);
    const c = await tx.moderationCase.create({ data: { targetType: input.targetType, targetId: input.targetId, severity: input.severity, openedByAdminUserId: actor.id, createdAt: await clock(tx) } });
    const reason = { reason: input.reason, reasonCode: input.reasonCode };
    await audit(tx, actor, c, "CASE_CREATED", reason);
    if (input.reportId) await attach(tx, actor, c, input.reportId, reason);
    return caseDto(c);
  });
}
export async function attachReport(db: PrismaClient, actor: Principal, caseId: string, raw: unknown) {
  parse(opaqueId, caseId); const input = parse(attachSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const c = await lockedCase(tx, caseId);
    await attach(tx, actor, c, input.reportId, { reason: input.reason, reasonCode: input.reasonCode });
    return { ok: true };
  });
}
export async function progressCase(db: PrismaClient, actor: Principal, caseId: string, action: "investigate" | "close", raw: unknown) {
  parse(opaqueId, caseId); const closing = action === "close" ? parse(closeSchema, raw) : null;
  const input = closing ?? parse(reasonSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const c = await lockedCase(tx, caseId); requireOpenCase(c.status);
    if (action === "investigate" && c.status !== "OPEN") throw new AppError("CONFLICT");
    const now = await clock(tx);
    if (action === "close") {
      const resolution = closing!.resolutionCode;
      await tx.report.updateMany({ where: { cases: { some: { caseId } }, status: "IN_REVIEW" }, data: { status: resolution, resolvedAt: now } });
      await tx.moderationCase.update({ where: { id: caseId }, data: { status: "CLOSED", closedAt: now, resolutionCode: resolution, resolutionNote: input.reason } });
    } else await tx.moderationCase.update({ where: { id: caseId }, data: { status: "INVESTIGATING" } });
    await audit(tx, actor, c, action === "close" ? "CASE_CLOSED" : "CASE_INVESTIGATING", { reason: input.reason, reasonCode: input.reasonCode }, { from: c.status, to: action === "close" ? "CLOSED" : "INVESTIGATING" });
    return { ok: true };
  });
}
export async function actOnCase(db: PrismaClient, actor: Principal, caseId: string, action: ModerationAction, raw: unknown) {
  parse(opaqueId, caseId); const input = parse(actionSchema, raw), type = actionTarget(action);
  const start = Date.now(), requestId = crypto.randomUUID();
  try {
    const result = await db.$transaction(async (tx) => {
      // Sorting prevents two admins restricting one another in opposite order.
      const ids = [...new Set(type === "USER" ? [actor.id, input.targetId] : [actor.id])].sort();
      for (const id of ids) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR NO KEY UPDATE`;
      await currentActor(tx, actor, "ADMIN", true);
      // Preliminary case read grants nothing; recheck under case lock AFTER resources.
      const initial = await tx.moderationCase.findUnique({ where: { id: caseId } });
      if (!initial) throw new AppError("NOT_FOUND");
      requireBinding(initial.targetType, initial.targetId, type, input.targetId);
      if (type === "USER") await lockModerationAccountScopes(tx, input.targetId);
      else if (type === "JOB") await lockModerationJob(tx, input.targetId);
      else if (type === "REVIEW") await lockModerationReview(tx, input.targetId);
      else await lockModerationEngagement(tx, input.targetId);
      const c = await lockedCase(tx, caseId); requireBinding(c.targetType, c.targetId, type, input.targetId); requireOpenCase(c.status);
      const now = await clock(tx);
      const event = await audit(tx, actor, c, actionNames[action], { reason: input.reason, reasonCode: input.reasonCode }, { action });
      if (action === "hide-job" || action === "unhide-job") await moderateJob(tx, input.targetId, action === "hide-job", event.id, now);
      else if (action === "hide-review" || action === "unhide-review") await moderateReview(tx, input.targetId, action === "hide-review", event.id, now);
      else if (action === "force-complete" || action === "force-cancel") await forceEngagement(tx, input.targetId, action, event.id, now);
      else await moderateAccount(tx, input.targetId, action, event.id);
      if (c.status !== "ACTIONED") await tx.moderationCase.update({ where: { id: caseId }, data: { status: "ACTIONED" } });
      return { ok: true };
    }, { timeout: 15000 });
    logger.event({ requestId, action: actionNames[action], actorId: actor.id, resourceType: type, resourceId: input.targetId, caseId, outcome: "success", durationMs: Date.now() - start });
    return result;
  } catch (error) {
    logger.event({ requestId, action: actionNames[action], actorId: actor.id, resourceType: type, resourceId: input.targetId, caseId, outcome: "failure", durationMs: Date.now() - start });
    throw error;
  }
}
export async function caseDetail(db: PrismaClient, actor: Principal, caseId: string) {
  parse(opaqueId, caseId);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const c = await tx.moderationCase.findUnique({ where: { id: caseId } });
    if (!c) throw new AppError("NOT_FOUND");
    let availableActions: ModerationAction[] = [];
    if (c.status !== "CLOSED") {
      if (c.targetType === "JOB") availableActions = [(await tx.job.findUniqueOrThrow({ where: { id: c.targetId }, select: { moderationHiddenAt: true } })).moderationHiddenAt ? "unhide-job" : "hide-job"];
      if (c.targetType === "REVIEW") availableActions = [(await tx.review.findUniqueOrThrow({ where: { id: c.targetId }, select: { hiddenAt: true } })).hiddenAt ? "unhide-review" : "hide-review"];
      if (c.targetType === "USER") {
        const { status } = await tx.user.findUniqueOrThrow({ where: { id: c.targetId }, select: { status: true } });
        availableActions = status === "ACTIVE" ? ["suspend", "ban"] : status === "SUSPENDED" ? ["unsuspend", "ban"] : [];
      }
      if (c.targetType === "ENGAGEMENT") {
        const { status } = await tx.engagement.findUniqueOrThrow({ where: { id: c.targetId }, select: { status: true } });
        availableActions = status === "IN_PROGRESS" ? ["force-complete", "force-cancel"] : status === "ACCEPTED" ? ["force-cancel"] : [];
      }
    }
    return { ...caseDto(c), availableActions };
  });
}
export async function caseTimeline(db: PrismaClient, actor: Principal, caseId: string, raw: unknown) {
  parse(opaqueId, caseId); const q = parse(timelineSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    if (!await tx.moderationCase.findUnique({ where: { id: caseId }, select: { id: true } })) throw new AppError("NOT_FOUND");
    const cursor = q.cursor ? await tx.auditEvent.findFirst({ where: { caseId, id: q.cursor }, select: { id: true, createdAt: true } }) : null;
    if (q.cursor && !cursor) throw new AppError("VALIDATION");
    const rows = await tx.auditEvent.findMany({ where: { caseId, ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}) }, select: { id: true, action: true, resourceType: true, resourceId: true, caseId: true, reasonCode: true, reason: true, createdAt: true, admin: { select: { name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return { items: page.map(({ admin, createdAt, ...r }) => ({ ...r, adminDisplay: admin.name, createdAt: createdAt.toISOString() })), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  });
}
export async function caseReports(db: PrismaClient, actor: Principal, caseId: string, raw: unknown) {
  parse(opaqueId, caseId); const q = parse(timelineSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    if (!await tx.moderationCase.findUnique({ where: { id: caseId }, select: { id: true } })) throw new AppError("NOT_FOUND");
    const rows = await tx.report.findMany({ where: { cases: { some: { caseId } }, ...(q.cursor ? { id: { gt: q.cursor } } : {}) },
      select: { id: true, reasonCode: true, details: true, status: true, createdAt: true, reporter: { select: { id: true, name: true } } }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    return { items: page.map(({ reporter, createdAt, ...r }) => ({ ...r, reporter: { id: reporter.id, displayName: reporter.name }, createdAt: createdAt.toISOString() })), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  });
}
export async function inspectCase(db: PrismaClient, actor: Principal, caseId: string, raw: unknown) {
  parse(opaqueId, caseId); const input = parse(reasonSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "ADMIN", true, true);
    const c = await lockedCase(tx, caseId);
    // Case-bound POST investigation: reason + immutable read audit, one resource.
    await audit(tx, actor, c, "CASE_CONTEXT_READ", input);
    if (c.targetType === "MESSAGE") return moderationMessageContext(tx, c.targetId);
    if (c.targetType === "REVIEW") return tx.review.findUnique({ where: { id: c.targetId }, select: { id: true, rating: true, comment: true, hiddenAt: true, direction: true } });
    if (c.targetType === "USER") return tx.user.findUnique({ where: { id: c.targetId }, select: { id: true, name: true, status: true } });
    if (c.targetType === "JOB") return tx.job.findUnique({ where: { id: c.targetId }, select: { id: true, title: true, description: true, status: true, moderationHiddenAt: true } });
    if (c.targetType === "COMPANY") return tx.company.findUnique({ where: { id: c.targetId }, select: { id: true, name: true, description: true, verification: true } });
    return tx.engagement.findUnique({ where: { id: c.targetId }, select: { id: true, status: true, acceptedAt: true, startedAt: true, completionRequestedAt: true, completedAt: true, cancelledAt: true } });
  });
}
