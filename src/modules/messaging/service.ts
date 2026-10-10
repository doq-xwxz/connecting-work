import { transaction } from "@/shared/db/transaction";
import "server-only";
import { requireRate } from "@/shared/security/rate-limit";
import { rateRules } from "@/shared/security/rate-config";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { lockChatApplication } from "@/modules/hiring/chat-query";
import { opaqueId, parse } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { requireEmployerProfile, requireWorkerProfile } from "@/modules/profiles/access";
import { messageDto, notificationDto } from "./projection";
import { blockSchema, chatPolicy, messagesSchema, newer, pageSchema, readSchema, requireSameBody, sendSchema, type Side } from "./contracts";

type Tx = Prisma.TransactionClient;
type Context = Awaited<ReturnType<typeof lockChatApplication>>;
const messageSelect = { id: true, body: true, senderSide: true, senderUserId: true, createdAt: true, sender: { select: { name: true } } } satisfies Prisma.MessageSelect;
async function identity(tx: Tx, actor: Principal, side: Side) {
  // NO KEY UPDATE conflicts with moderation/role FOR UPDATE, but permits recipient
  // foreign-key KEY SHARE locks during concurrent opposite-direction sends.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR NO KEY UPDATE`;
  const user = await currentActor(tx, actor, side);
  if (user.status === "BANNED") throw new AppError("FORBIDDEN");
  return user;
}
async function scoped(tx: Tx, actor: Principal, side: Side, id: string) {
  const user = await identity(tx, actor, side);
  const initial = await tx.conversation.findUnique({ where: { id }, select: { applicationId: true } });
  if (!initial) throw new AppError("NOT_FOUND");
  const context = await lockChatApplication(tx, actor, side, initial.applicationId);
  await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${id} FOR UPDATE`;
  return { user, context };
}
function scopeWhere(actorId: string, side: Side): Prisma.ConversationWhereInput {
  return side === "WORKER" ? { worker: { userId: actorId } } : { job: { OR: [
    { companyId: null, employer: { userId: actorId } },
    { company: { members: { some: { userId: actorId, role: { in: ["OWNER", "MANAGER"] } } } } },
  ] } };
}
async function blocked(tx: Tx, context: Context) {
  const worker = context.worker.userId;
  // A block with any CURRENT Company participant disables pre-work contact for
  // this Company context; switching recruiters cannot bypass it. No fan-out.
  const employer: Prisma.UserWhereInput = context.job.companyId
    ? { companyMemberships: { some: { companyId: context.job.companyId, role: { in: ["OWNER", "MANAGER"] } } } }
    : { id: context.job.employer.userId };
  return !!await tx.userBlock.findFirst({ where: { OR: [
    { blockerUserId: worker, blocked: employer }, { blockedUserId: worker, blocker: employer },
  ] }, select: { blockerUserId: true } });
}
async function permission(tx: Tx, context: Context, status: string, side: Side) {
  return chatPolicy({ actorStatus: status,
    counterpartyBanned: side === "EMPLOYER" ? context.worker.user.status === "BANNED" : !context.job.companyId && context.job.employer.user.status === "BANNED",
    application: context.status, engagement: context.engagement?.status ?? null, job: context.job.status, blocked: await blocked(tx, context) });
}
async function unread(tx: Tx, id: string, userId: string) {
  const state = await tx.conversationReadState.findUnique({ where: { conversationId_userId: { conversationId: id, userId } }, select: { lastReadMessage: { select: { id: true, createdAt: true } } } });
  const position = state?.lastReadMessage;
  return tx.message.count({ where: { conversationId: id, senderUserId: { not: userId }, ...(position ? { OR: [
    { createdAt: { gt: position.createdAt } }, { createdAt: position.createdAt, id: { gt: position.id } },
  ] } : {}) } });
}
async function summary(tx: Tx, actor: Principal, side: Side, id: string, context: Context, status: string) {
  const last = await tx.message.findFirst({ where: { conversationId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } });
  const reason = await permission(tx, context, status, side);
  return { id, applicationId: context.id, job: { id: context.jobId, title: context.job.title, status: context.job.status }, company: context.job.company?.name ?? null,
    counterpartyDisplay: side === "EMPLOYER" ? context.worker.user.name : context.job.company?.name ?? context.job.employer.user.name,
    lastMessageAt: last?.createdAt.toISOString() ?? null, unreadCount: await unread(tx, id, actor.id), messagingAllowed: reason === null, disabledReason: reason };
}
export async function openConversation(db: PrismaClient, actor: Principal, side: Side, applicationId: string, raw: unknown) {
  parse(opaqueId, applicationId); parse(pageSchema.pick({}).strict(), raw);
  return transaction(db, async (tx) => {
    const user = await identity(tx, actor, side);
    const context = await lockChatApplication(tx, actor, side, applicationId);
    const previous = await tx.conversation.findUnique({ where: { applicationId }, select: { id: true } });
    if (previous) return summary(tx, actor, side, previous.id, context, user.status);
    // Restricted/terminal users can read an existing history, not initiate a new chat.
    if (await permission(tx, context, user.status, side)) throw new AppError("FORBIDDEN");
    const conversation = await tx.conversation.create({ data: { applicationId, jobId: context.jobId, workerProfileId: context.workerProfileId } });
    return summary(tx, actor, side, conversation.id, context, user.status);
  });
}
export async function getConversation(db: PrismaClient, actor: Principal, side: Side, id: string) {
  parse(opaqueId, id);
  return transaction(db, async (tx) => { const { user, context } = await scoped(tx, actor, side, id); return summary(tx, actor, side, id, context, user.status); });
}
export async function listConversations(db: PrismaClient, actor: Principal, side: Side, raw: unknown) {
  const query = parse(pageSchema, raw);
  return transaction(db, async (tx) => {
    await identity(tx, actor, side);
    const profile = side === "EMPLOYER" ? await requireEmployerProfile(tx, actor.id) : await requireWorkerProfile(tx, actor.id);
    const where = scopeWhere(actor.id, side);
    // Counts run only on the explicit inbox request; no navigation-wide scans.
    const scope = side === "WORKER" ? Prisma.sql`c."workerProfileId"=${profile.id}` : Prisma.sql`
      ((j."companyId" IS NULL AND j."employerProfileId"=${profile.id}) OR EXISTS(SELECT 1 FROM "CompanyMember" cm WHERE cm."companyId"=j."companyId" AND cm."userId"=${actor.id} AND cm.role IN ('OWNER','MANAGER')))`;
    const [totals] = await tx.$queryRaw<{ messages: bigint; conversations: bigint }[]>`WITH authorized AS MATERIALIZED (
      SELECT c.id FROM "Conversation" c JOIN "Job" j ON j.id=c."jobId" WHERE ${scope}
      ) SELECT COALESCE(sum(s.messages),0)::bigint AS messages, count(*) FILTER (WHERE s.messages>0) AS conversations
      FROM authorized c
      LEFT JOIN "ConversationReadState" r ON r."conversationId"=c.id AND r."userId"=${actor.id}
      LEFT JOIN "Message" p ON p.id=r."lastReadMessageId"
      CROSS JOIN LATERAL (SELECT count(*) AS messages FROM "Message" m WHERE m."conversationId"=c.id
        AND m."senderUserId"<>${actor.id} AND (p.id IS NULL OR (m."createdAt",m.id)>(p."createdAt",p.id))) s`;
    const rows = await tx.conversation.findMany({ where: { ...where, ...(query.cursor ? { id: { gt: query.cursor } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take: query.limit + 1 });
    // Reapply current SQL scope while hydrating bounded rows; do not acquire
    // multiple owner/contact locks in one list transaction.
    const items = await tx.conversation.findMany({ where: { ...where, id: { in: rows.slice(0, query.limit).map((r) => r.id) } }, select: { id: true, lastMessageAt: true,
      applicationId: true, job: { select: { title: true, company: { select: { name: true } }, employer: { select: { user: { select: { name: true } } } } } },
      worker: { select: { user: { select: { name: true } } } }, reads: { where: { userId: actor.id }, select: { lastReadMessage: { select: { id: true, createdAt: true } } } },
      messages: { where: { senderUserId: { not: actor.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, createdAt: true } } }, orderBy: { id: "asc" } });
    return { items: items.map((r) => ({ id: r.id, jobTitle: r.job.title, company: r.job.company?.name ?? null, counterpartyDisplay: side === "WORKER" ? r.job.company?.name ?? r.job.employer.user.name : r.worker.user.name,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null, unread: !!r.messages[0] && (!r.reads[0] || newer(r.messages[0], r.reads[0].lastReadMessage)) })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null, unreadMessages: Number(totals.messages), unreadConversations: Number(totals.conversations) };
  });
}
export async function listMessages(db: PrismaClient, actor: Principal, side: Side, id: string, raw: unknown) {
  parse(opaqueId, id); const query = parse(messagesSchema, raw);
  return transaction(db, async (tx) => {
    await scoped(tx, actor, side, id);
    const cursorId = query.before ?? query.after;
    const cursor = cursorId ? await tx.message.findFirst({ where: { id: cursorId, conversationId: id }, select: { id: true, createdAt: true } }) : null;
    if (cursorId && !cursor) throw new AppError("VALIDATION");
    const forward = !!query.after;
    const position: Prisma.MessageWhereInput = cursor ? { OR: forward ? [
      { createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ] : [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {};
    const rows = await tx.message.findMany({ where: { conversationId: id, ...position }, select: messageSelect,
      orderBy: [{ createdAt: forward ? "asc" : "desc" }, { id: forward ? "asc" : "desc" }], take: query.limit + 1 });
    const page = rows.slice(0, query.limit); if (!forward) page.reverse();
    return { items: page.map((row) => messageDto(row, actor.id)), hasMore: rows.length > query.limit, oldest: page[0]?.id ?? null, newest: page.at(-1)?.id ?? query.after ?? null };
  });
}
async function budget(tx: Tx, userId: string, conversationId: string) {
  await requireRate(tx, `message:user:${userId}`, rateRules.messageUser);
  await requireRate(tx, `message:conversation:${userId}:${conversationId}`, rateRules.messageConversation);
}
export async function sendMessage(db: PrismaClient, actor: Principal, side: Side, id: string, raw: unknown) {
  parse(opaqueId, id); const input = parse(sendSchema, raw);
  return transaction(db, async (tx) => {
    const { user, context } = await scoped(tx, actor, side, id);
    if (await permission(tx, context, user.status, side)) throw new AppError("FORBIDDEN");
    const previous = await tx.message.findUnique({ where: { conversationId_senderUserId_creationKey: { conversationId: id, senderUserId: actor.id, creationKey: input.creationKey } }, select: messageSelect });
    if (previous) { requireSameBody(previous.body, input.body); return messageDto(previous, actor.id); }
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    await budget(tx, actor.id, id);
    // Millisecond strictly increasing conversation time prevents a later inserted
    // random UUID from sorting behind an existing cursor in the same DB millisecond.
    const last = await tx.conversation.findUniqueOrThrow({ where: { id }, select: { lastMessageAt: true } });
    const createdAt = new Date(Math.max(clock.now.getTime(), (last.lastMessageAt?.getTime() ?? 0) + 1));
    const message = await tx.message.create({ data: { conversationId: id, senderUserId: actor.id, senderSide: side, ...input, createdAt }, select: messageSelect });
    await tx.conversation.update({ where: { id }, data: { lastMessageAt: createdAt } });
    const recipient = side === "EMPLOYER" ? context.worker.userId : context.job.companyId ? null : context.job.employer.userId;
    if (recipient && recipient !== actor.id) {
      const existing = await tx.notification.findFirst({ where: { userId: recipient, conversationId: id, readAt: null }, select: { id: true } });
      if (existing) await tx.notification.update({ where: { id: existing.id }, data: { lastMessageId: message.id } });
      else await tx.notification.create({ data: { userId: recipient, conversationId: id, lastMessageId: message.id } });
    }
    return messageDto(message, actor.id);
  });
}
async function mark(tx: Tx, actorId: string, id: string, messageId: string) {
  const message = await tx.message.findFirst({ where: { id: messageId, conversationId: id }, select: { id: true, createdAt: true } });
  if (!message) throw new AppError("NOT_FOUND");
  const previous = await tx.conversationReadState.findUnique({ where: { conversationId_userId: { conversationId: id, userId: actorId } }, select: { lastReadMessage: { select: { id: true, createdAt: true } } } });
  const target = previous && !newer(message, previous.lastReadMessage) ? previous.lastReadMessage : message;
  await tx.conversationReadState.upsert({ where: { conversationId_userId: { conversationId: id, userId: actorId } }, create: { conversationId: id, userId: actorId, lastReadMessageId: target.id }, update: { lastReadMessageId: target.id } });
  const notification = await tx.notification.findFirst({ where: { conversationId: id, userId: actorId, readAt: null }, select: { id: true, lastMessage: { select: { id: true, createdAt: true } } } });
  if (notification && !newer(notification.lastMessage, target)) await tx.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  return { ok: true };
}
export async function markConversationRead(db: PrismaClient, actor: Principal, side: Side, id: string, raw: unknown) {
  parse(opaqueId, id); const { messageId } = parse(readSchema, raw);
  return transaction(db, async (tx) => { await scoped(tx, actor, side, id); return mark(tx, actor.id, id, messageId); });
}
export async function setBlock(db: PrismaClient, actor: Principal, side: Side, id: string, raw: unknown) {
  parse(opaqueId, id); const input = parse(blockSchema, raw);
  return transaction(db, async (tx) => {
    const { context } = await scoped(tx, actor, side, id);
    const message = await tx.message.findFirst({ where: { id: input.messageId, conversationId: id, senderSide: side === "WORKER" ? "EMPLOYER" : "WORKER" }, select: { senderUserId: true } });
    if (!message || message.senderUserId === actor.id || (side === "EMPLOYER" && message.senderUserId !== context.worker.userId)) throw new AppError("NOT_FOUND");
    const pair = { blockerUserId: actor.id, blockedUserId: message.senderUserId };
    if (input.blocked) await tx.userBlock.upsert({ where: { blockerUserId_blockedUserId: pair }, create: pair, update: {} });
    else await tx.userBlock.deleteMany({ where: pair });
    return { ok: true };
  });
}
export async function listNotifications(db: PrismaClient, actor: Principal, raw: unknown) {
  const query = parse(pageSchema, raw);
  return transaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { status: true, roles: { select: { role: true } } } });
    if (!user || user.status === "BANNED") throw new AppError("FORBIDDEN");
    const allowed: Prisma.ConversationWhereInput[] = [];
    if (user.roles.some((r) => r.role === "WORKER")) allowed.push(scopeWhere(actor.id, "WORKER"));
    if (user.roles.some((r) => r.role === "EMPLOYER")) allowed.push(scopeWhere(actor.id, "EMPLOYER"));
    const rows = await tx.notification.findMany({ where: { userId: actor.id, conversation: { OR: allowed }, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: "asc" }, take: query.limit + 1, select: { id: true, type: true, readAt: true, createdAt: true, lastMessageId: true,
        conversation: { select: { id: true, job: { select: { title: true } }, worker: { select: { userId: true } } } } } });
    return { items: rows.slice(0, query.limit).map((r) => notificationDto(r, actor.id)), nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null };
  });
}
export async function readNotification(db: PrismaClient, actor: Principal, id: string, raw: unknown) {
  parse(opaqueId, id); const { messageId } = parse(readSchema, raw);
  return transaction(db, async (tx) => {
    const notification = await tx.notification.findFirst({ where: { id, userId: actor.id }, select: { conversationId: true, conversation: { select: { worker: { select: { userId: true } } } } } });
    if (!notification) throw new AppError("NOT_FOUND");
    const side = notification.conversation.worker.userId === actor.id ? "WORKER" : "EMPLOYER";
    await scoped(tx, actor, side, notification.conversationId);
    return mark(tx, actor.id, notification.conversationId, messageId);
  });
}
