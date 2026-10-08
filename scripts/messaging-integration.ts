import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import type { Principal, Role } from "../src/modules/auth/policy";
import { AppError } from "../src/shared/errors/app-error";
import { saveEmployer, saveWorker } from "../src/modules/profiles/service";
import { createCompany, removeManager } from "../src/modules/companies/service";
import { createJob, getManagedJob, transitionJob } from "../src/modules/jobs/service";
import { actOnApplication, actOnEngagement, actOnOffer, applyToJob, createOffer } from "../src/modules/hiring/service";
import { getConversation, listConversations, listMessages, listNotifications, markConversationRead, openConversation, readNotification, sendMessage, setBlock } from "../src/modules/messaging/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: messaging requires TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12 }) });
  const users: string[] = [], companies: string[] = [];
  let stage = "fixtures";
  async function actor(roles: Role[]) {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Messaging display", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const principal: Principal = { id, name: "Messaging display", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER")) await saveEmployer(db, principal, { type: "INDIVIDUAL", city: null, description: "" });
    if (roles.includes("WORKER")) await saveWorker(db, principal, { headline: "Excel worker", city: null, bio: "Private", timezone: "Asia/Ho_Chi_Minh", preferences: ["FULL_TIME"], workModes: ["REMOTE"], skills: [{ skillId: (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id, level: "INTERMEDIATE" }], availability: [] });
    return principal;
  }
  async function denied(action: () => Promise<unknown>, code: string) { await assert.rejects(action, (e: unknown) => e instanceof AppError && e.code === code); }
  const input = (body = "Hello") => ({ body, creationKey: randomUUID() });
  async function waitForLock() {
    for (let attempt = 0; attempt < 150; attempt++) {
      const [r] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`;
      if (r.n > 0n) return; await delay(20);
    }
    throw new Error("Lock wait was not observed");
  }
  try {
    const owner = await actor(["EMPLOYER"]), worker = await actor(["WORKER"]), other = await actor(["WORKER", "EMPLOYER"]), manager = await actor(["EMPLOYER"]), admin = await actor(["ADMIN"]);
    const skillId = (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id;
    const company = await createCompany(db, owner, { name: "Messaging Company", description: "", city: null, website: null, creationKey: randomUUID() }); companies.push(company.id);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    async function job(companyId: string | null = null) {
      const row = await createJob(db, owner, { title: "Messaging job", description: "Work terms", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: null,
        compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2, startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh",
        skills: [{ skillId, required: true, minimumLevel: "BEGINNER" }], schedule: [], companyId, creationKey: randomUUID() });
      return transitionJob(db, owner, row.id, "publish", { expectedVersion: row.version });
    }
    const personal = await job(), owned = await job(company.id);
    await denied(() => openConversation(db, worker, "WORKER", randomUUID(), {}), "NOT_FOUND");
    const application = await applyToJob(db, worker, personal.id, { creationKey: randomUUID() });
    assert.equal(await db.conversation.count({ where: { applicationId: application.id } }), 0);
    stage = "lazy creation, entitlement and current participant scope";
    const opened = await Promise.all([openConversation(db, worker, "WORKER", application.id, {}), openConversation(db, owner, "EMPLOYER", application.id, {})]);
    const id = opened[0].id; assert.equal(opened[1].id, id); assert.equal(await db.conversation.count({ where: { applicationId: application.id } }), 1);
    await denied(() => getConversation(db, other, "WORKER", id), "NOT_FOUND"); await denied(() => getConversation(db, other, "EMPLOYER", id), "NOT_FOUND");
    await denied(() => getConversation(db, admin, "EMPLOYER", id), "FORBIDDEN");
    await db.userRole.delete({ where: { userId_role: { userId: worker.id, role: "WORKER" } } });
    await denied(() => listMessages(db, worker, "WORKER", id, {}), "FORBIDDEN");
    await db.userRole.create({ data: { userId: worker.id, role: "WORKER", grantedBy: "fixture" } });
    stage = "atomic duplicate and opposite-direction sends";
    const body = input("<script>alert('plain')</script>\r\nline");
    const pair = await Promise.all([sendMessage(db, worker, "WORKER", id, body), sendMessage(db, worker, "WORKER", id, body)]);
    assert.equal(pair[0].id, pair[1].id); assert.match(pair[0].body, /\nline/); assert.equal(pair[0].body.includes("\r"), false);
    await denied(() => sendMessage(db, worker, "WORKER", id, { ...body, body: "Different" }), "CONFLICT");
    const replies = await Promise.all([sendMessage(db, worker, "WORKER", id, input("Worker simultaneous")), sendMessage(db, owner, "EMPLOYER", id, input("Employer simultaneous"))]);
    assert.equal(new Set(replies.map((m) => m.id)).size, 2); assert.equal(await db.message.count({ where: { conversationId: id } }), 3);
    for (const secret of [owner.id, worker.id, owner.email, worker.email, "senderUserId", "emailVerified"]) assert.ok(!JSON.stringify(replies).includes(secret));
    assert.equal(await db.notification.count({ where: { conversationId: id, userId: owner.id, readAt: null } }), 1);
    assert.equal(await db.notification.count({ where: { conversationId: id, userId: worker.id, readAt: null } }), 1);
    stage = "bounded older/forward pages, scope-bound cursors and monotonic reads";
    const all = await listMessages(db, worker, "WORKER", id, {}); assert.equal(all.items.length, 3);
    const recent = await listMessages(db, worker, "WORKER", id, { limit: 1 }); assert.equal(recent.items[0].id, all.newest); assert.equal(recent.hasMore, true);
    const before = await listMessages(db, worker, "WORKER", id, { limit: 1, before: recent.oldest }); assert.equal(before.items[0].id, all.items[1].id);
    const forward = await listMessages(db, owner, "EMPLOYER", id, { after: all.oldest }); assert.equal(forward.items.length, 2);
    await denied(() => listMessages(db, worker, "WORKER", id, { after: randomUUID() }), "VALIDATION");
    const incoming = all.items.find((m) => m.senderSide === "EMPLOYER")!;
    assert.equal((await listConversations(db, worker, "WORKER", {})).unreadMessages, 1);
    await Promise.all([markConversationRead(db, worker, "WORKER", id, { messageId: all.newest }), markConversationRead(db, worker, "WORKER", id, { messageId: all.oldest })]);
    assert.equal((await db.conversationReadState.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: id, userId: worker.id } } })).lastReadMessageId, all.newest);
    assert.equal((await listConversations(db, worker, "WORKER", {})).unreadMessages, 0);
    const newestReply = await sendMessage(db, owner, "EMPLOYER", id, input("New incoming"));
    const notices = await listNotifications(db, worker, {}); const notice = notices.items.find((n) => !n.read)!; assert.ok(notice); assert.equal(notice.messageId, newestReply.id);
    await denied(() => readNotification(db, other, notice.id, { messageId: newestReply.id }), "NOT_FOUND");
    await readNotification(db, worker, notice.id, { messageId: incoming.id });
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: notice.id } })).readAt, null);
    await readNotification(db, worker, notice.id, { messageId: newestReply.id });
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: notice.id } })).readAt);
    stage = "directional blocks, readable history and cross-Job contact scope";
    await setBlock(db, worker, "WORKER", id, { messageId: incoming.id, blocked: true });
    await setBlock(db, worker, "WORKER", id, { messageId: incoming.id, blocked: true });
    assert.equal(await db.userBlock.count({ where: { blockerUserId: worker.id, blockedUserId: owner.id } }), 1);
    await denied(() => sendMessage(db, owner, "EMPLOYER", id, input()), "FORBIDDEN"); await denied(() => sendMessage(db, worker, "WORKER", id, input()), "FORBIDDEN");
    assert.equal((await listMessages(db, worker, "WORKER", id, {})).items.length, 4);
    assert.equal((await db.application.findUniqueOrThrow({ where: { id: application.id } })).status, "APPLIED");
    await assert.rejects(() => db.userBlock.create({ data: { blockerUserId: worker.id, blockedUserId: worker.id } }));
    await denied(() => setBlock(db, worker, "WORKER", id, { messageId: pair[0].id, blocked: true }), "NOT_FOUND");
    await setBlock(db, worker, "WORKER", id, { messageId: incoming.id, blocked: false });
    await setBlock(db, owner, "EMPLOYER", id, { messageId: pair[0].id, blocked: true });
    await denied(() => sendMessage(db, worker, "WORKER", id, input()), "FORBIDDEN");
    await setBlock(db, owner, "EMPLOYER", id, { messageId: pair[0].id, blocked: false });
    stage = "fresh suspension while send waits on User lock";
    let suspended: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${worker.id} FOR UPDATE`;
      suspended = sendMessage(db, worker, "WORKER", id, input()).catch((e: unknown) => e); await waitForLock();
      await tx.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } });
    });
    assert.ok(await suspended instanceof AppError); await denied(() => sendMessage(db, worker, "WORKER", id, input()), "FORBIDDEN");
    assert.equal((await listMessages(db, worker, "WORKER", id, {})).items.length, 4);
    await db.user.update({ where: { id: worker.id }, data: { status: "ACTIVE" } });
    stage = "block commit while send waits on PG contact lock";
    let blockedSend: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('messaging-worker:' || ${worker.id},0))::text`;
      blockedSend = sendMessage(db, owner, "EMPLOYER", id, input()).catch((e: unknown) => e); await waitForLock();
      await tx.userBlock.create({ data: { blockerUserId: worker.id, blockedUserId: owner.id } });
    });
    assert.ok(await blockedSend instanceof AppError);
    stage = "active Engagement overrides block/suspension and CLOSED";
    await actOnApplication(db, owner, application.id, "shortlist", {});
    const offer = await createOffer(db, owner, application.id, { creationKey: randomUUID(), expiresAt: null });
    await transitionJob(db, owner, personal.id, "close", { expectedVersion: (await getManagedJob(db, owner, personal.id)).version });
    const accepted = await actOnOffer(db, worker, offer.id, "accept", {}); const engagementId = accepted.engagement!.id;
    await db.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } });
    await sendMessage(db, worker, "WORKER", id, input("Obligation chat")); await sendMessage(db, owner, "EMPLOYER", id, input("Obligation reply"));
    await db.user.update({ where: { id: worker.id }, data: { status: "BANNED" } });
    await denied(() => getConversation(db, worker, "WORKER", id), "FORBIDDEN"); await denied(() => sendMessage(db, owner, "EMPLOYER", id, input()), "FORBIDDEN");
    await db.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } });
    await actOnEngagement(db, owner, "EMPLOYER", engagementId, "start", {}); await actOnEngagement(db, worker, "WORKER", engagementId, "request-completion", {});
    await actOnEngagement(db, owner, "EMPLOYER", engagementId, "confirm-completion", {});
    await denied(() => sendMessage(db, worker, "WORKER", id, input()), "FORBIDDEN");
    await db.user.update({ where: { id: worker.id }, data: { status: "ACTIVE" } });
    await setBlock(db, worker, "WORKER", id, { messageId: incoming.id, blocked: false });
    await denied(() => sendMessage(db, owner, "EMPLOYER", id, input()), "FORBIDDEN"); assert.ok((await listMessages(db, worker, "WORKER", id, {})).items.length > 0);
    stage = "Company authorship, independent manager read states and current revocation";
    const ca = await applyToJob(db, worker, owned.id, { creationKey: randomUUID() });
    const companyChat = await openConversation(db, manager, "EMPLOYER", ca.id, {});
    const cm = await sendMessage(db, manager, "EMPLOYER", companyChat.id, input("Company manager"));
    await denied(() => listMessages(db, worker, "WORKER", id, { after: cm.id }), "VALIDATION");
    await denied(() => markConversationRead(db, worker, "WORKER", id, { messageId: cm.id }), "NOT_FOUND");
    await sendMessage(db, worker, "WORKER", companyChat.id, input("Company reply"));
    assert.equal(await db.notification.count({ where: { conversationId: companyChat.id, userId: { in: [manager.id, owner.id] } } }), 0);
    assert.equal((await listConversations(db, owner, "EMPLOYER", {})).unreadMessages >= 1, true);
    await markConversationRead(db, manager, "EMPLOYER", companyChat.id, { messageId: (await listMessages(db, manager, "EMPLOYER", companyChat.id, {})).newest });
    // Per-user reads also include messages authored by another current manager.
    assert.equal((await getConversation(db, owner, "EMPLOYER", companyChat.id)).unreadCount, 2);
    const readRace = await Promise.all([
      sendMessage(db, owner, "EMPLOYER", companyChat.id, input("Read/send race")),
      markConversationRead(db, worker, "WORKER", companyChat.id, { messageId: cm.id }),
    ]);
    assert.equal(await db.notification.count({ where: { conversationId: companyChat.id, userId: worker.id, readAt: null, lastMessageId: (readRace[0] as { id: string }).id } }), 1);
    await setBlock(db, worker, "WORKER", companyChat.id, { messageId: cm.id, blocked: true });
    await denied(() => sendMessage(db, owner, "EMPLOYER", companyChat.id, input()), "FORBIDDEN");
    await setBlock(db, worker, "WORKER", companyChat.id, { messageId: cm.id, blocked: false });
    let revoked: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${company.id} FOR UPDATE`;
      revoked = sendMessage(db, manager, "EMPLOYER", companyChat.id, input()).catch((e: unknown) => e); await waitForLock();
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: manager.id } } });
    });
    assert.ok(await revoked instanceof AppError);
    await denied(() => getConversation(db, manager, "EMPLOYER", companyChat.id), "NOT_FOUND");
    assert.equal((await listConversations(db, manager, "EMPLOYER", {})).items.length, 0);
    assert.equal((await listMessages(db, owner, "EMPLOYER", companyChat.id, {})).items.some((m) => m.id === cm.id), true);
    await sendMessage(db, owner, "EMPLOYER", companyChat.id, input("Current owner"));
    // Public revocation also takes the same Company lock.
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } }); await removeManager(db, owner, company.id, manager.id);
    stage = "terminal application and cancelled Engagement histories";
    const ended = await applyToJob(db, other, owned.id, { creationKey: randomUUID() });
    const endedChat = await openConversation(db, other, "WORKER", ended.id, {}); await sendMessage(db, other, "WORKER", endedChat.id, input());
    await actOnApplication(db, other, ended.id, "withdraw", {}); await denied(() => sendMessage(db, owner, "EMPLOYER", endedChat.id, input()), "FORBIDDEN");
    assert.equal((await listMessages(db, owner, "EMPLOYER", endedChat.id, {})).items.length, 1);
    await actOnApplication(db, owner, ca.id, "shortlist", {}); const co = await createOffer(db, owner, ca.id, { creationKey: randomUUID(), expiresAt: null });
    const ce = await actOnOffer(db, worker, co.id, "accept", {});
    await actOnEngagement(db, worker, "WORKER", ce.engagement!.id, "cancel", { category: "OTHER", reason: "Fixture cancellation" });
    await denied(() => sendMessage(db, worker, "WORKER", companyChat.id, input()), "FORBIDDEN");
    stage = "rejected/cancelled Application histories and creator departure";
    const rejectedJob = await job(), cancelledJob = await job();
    const rejected = await applyToJob(db, worker, rejectedJob.id, { creationKey: randomUUID() });
    const rejectedChat = await openConversation(db, worker, "WORKER", rejected.id, {}); await sendMessage(db, worker, "WORKER", rejectedChat.id, input());
    await actOnApplication(db, owner, rejected.id, "reject", {});
    await denied(() => sendMessage(db, worker, "WORKER", rejectedChat.id, input()), "FORBIDDEN"); assert.equal((await listMessages(db, worker, "WORKER", rejectedChat.id, {})).items.length, 1);
    const cancelled = await applyToJob(db, worker, cancelledJob.id, { creationKey: randomUUID() });
    const cancelledChat = await openConversation(db, worker, "WORKER", cancelled.id, {}); await sendMessage(db, worker, "WORKER", cancelledChat.id, input());
    await transitionJob(db, owner, cancelledJob.id, "cancel", { expectedVersion: cancelledJob.version });
    await denied(() => sendMessage(db, worker, "WORKER", cancelledChat.id, input()), "FORBIDDEN"); assert.equal((await listMessages(db, worker, "WORKER", cancelledChat.id, {})).items.length, 1);
    const freshWorker = await actor(["WORKER"]); const freshApplication = await applyToJob(db, freshWorker, owned.id, { creationKey: randomUUID() });
    const departureChat = await openConversation(db, owner, "EMPLOYER", freshApplication.id, {});
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    await db.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: owner.id } } });
    await denied(() => getConversation(db, owner, "EMPLOYER", departureChat.id), "NOT_FOUND");
    await sendMessage(db, manager, "EMPLOYER", departureChat.id, input("Company persists after creator departure"));
    assert.equal((await listMessages(db, freshWorker, "WORKER", departureChat.id, {})).items.length, 1);
    stage = "database uniqueness, immutability and consistency";
    await assert.rejects(() => db.message.update({ where: { id: pair[0].id }, data: { body: "Changed" } }));
    await assert.rejects(() => db.message.create({ data: { conversationId: id, senderUserId: owner.id, senderSide: "EMPLOYER", body: " ", creationKey: randomUUID() } }));
    await assert.rejects(() => db.conversationReadState.create({ data: { conversationId: companyChat.id, userId: other.id, lastReadMessageId: pair[0].id } }));
    await assert.rejects(() => db.conversation.delete({ where: { id } }));
    await assert.rejects(async () => db.conversation.create({ data: { applicationId: application.id, jobId: personal.id, workerProfileId: (await db.workerProfile.findUniqueOrThrow({ where: { userId: other.id } })).id } }));
    const tiedIds = [randomUUID(), randomUUID()].sort(); const tiedTime = new Date(Date.now() - 60_000);
    for (const messageId of tiedIds) await db.message.create({ data: { id: messageId, conversationId: rejectedChat.id, senderUserId: owner.id, senderSide: "EMPLOYER", body: "Historical tied position", creationKey: randomUUID(), createdAt: tiedTime } });
    const tiedPage = await listMessages(db, worker, "WORKER", rejectedChat.id, { after: tiedIds[0] });
    assert.equal(tiedPage.items[0].id, tiedIds[1]);
    const tiedBefore = await listMessages(db, worker, "WORKER", rejectedChat.id, { before: tiedIds[1] }); assert.equal(tiedBefore.items.at(-1)!.id, tiedIds[0]);
    const indexes = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('Message','ConversationReadState','UserBlock','Notification')`;
    for (const name of ["Message_conversationId_createdAt_id_idx", "ConversationReadState_userId_conversationId_idx", "UserBlock_blockedUserId_blockerUserId_idx", "Notification_one_unread_conversation"]) assert.ok(indexes.some((r) => r.indexname === name));
    stage = "persisted per-conversation/global rate limits and free authorized replay";
    const floodJob = await job(); const fa = await applyToJob(db, worker, floodJob.id, { creationKey: randomUUID() }); const fc = await openConversation(db, worker, "WORKER", fa.id, {});
    const firstFlood = input("First retry"); const saved = await sendMessage(db, worker, "WORKER", fc.id, firstFlood);
    for (let n = 1; n < 30; n++) await sendMessage(db, worker, "WORKER", fc.id, input(`Bounded ${n}`));
    await denied(() => sendMessage(db, worker, "WORKER", fc.id, input("Over budget")), "RATE_LIMITED");
    assert.equal((await sendMessage(db, worker, "WORKER", fc.id, firstFlood)).id, saved.id);
    const key = `message:user:${owner.id}`;
    await db.rateLimit.upsert({ where: { key }, create: { id: randomUUID(), key, count: 60, lastRequest: BigInt(Date.now()) }, update: { count: 60, lastRequest: BigInt(Date.now()) } });
    await denied(() => sendMessage(db, owner, "EMPLOYER", fc.id, input()), "RATE_LIMITED");
    assert.equal(await db.message.count({ where: { conversationId: fc.id } }), 30);
    console.info("PASS: Phase 7 PostgreSQL entitlement/current membership/role/status, real observed lock races, duplicate and two-way sends, pagination, monotonic read/unread, coalesced private notifications, blocks, active obligations, terminal history, constraints and shared rate budgets.");
  } catch (error) {
    if (error instanceof AppError) console.error(`Policy failure code: ${error.code}`);
    console.error(`FAIL: messaging PostgreSQL verification at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const jobIds = (await db.job.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((r) => r.id);
      const chatIds = (await db.conversation.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } })).map((r) => r.id);
      await db.notification.deleteMany({ where: { conversationId: { in: chatIds } } }); await db.conversationReadState.deleteMany({ where: { conversationId: { in: chatIds } } });
      await db.message.deleteMany({ where: { conversationId: { in: chatIds } } }); await db.conversation.deleteMany({ where: { id: { in: chatIds } } });
      await db.userBlock.deleteMany({ where: { OR: [{ blockerUserId: { in: users } }, { blockedUserId: { in: users } }] } });
      await db.rateLimit.deleteMany({ where: { OR: users.flatMap((id) => [{ key: `message:user:${id}` }, { key: { startsWith: `message:conversation:${id}:` } }]) } });
      await db.engagement.deleteMany({ where: { jobId: { in: jobIds } } }); await db.offer.deleteMany({ where: { jobId: { in: jobIds } } }); await db.application.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.jobSkill.deleteMany({ where: { jobId: { in: jobIds } } }); await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: jobIds } } }); await db.job.deleteMany({ where: { id: { in: jobIds } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } }); await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } }); await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: messaging fixture cleanup; sensitive diagnostics suppressed."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
