import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Principal, Role } from "../src/modules/auth/policy";
import { currentActor } from "../src/modules/auth/transaction";
import { lockModerationAccountScopes, moderateAccount } from "../src/modules/auth/moderation";
import { lockModerationJob, moderateJob } from "../src/modules/jobs/moderation";
import { AppError } from "../src/shared/errors/app-error";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import { saveEmployer, saveWorker, setDiscoverable } from "../src/modules/profiles/service";
import { createCompany } from "../src/modules/companies/service";
import { createJob, getPublicJob, listPublicJobs, transitionJob } from "../src/modules/jobs/service";
import { actOnApplication, actOnEngagement, actOnOffer, applyToJob, createOffer } from "../src/modules/hiring/service";
import { getEngagementReviews, submitReview } from "../src/modules/reviews/service";
import { getWorkerReputationFacts } from "../src/modules/reviews/query";
import { recommendedCandidates, recommendedJobs } from "../src/modules/matching/service";
import { getConversation, listMessages, openConversation, sendMessage } from "../src/modules/messaging/service";
import { actOnCase, attachReport, caseDetail, caseReports, caseTimeline, createCase, createReport, inspectCase, listAdminReports, listCases, listOwnReports, progressCase, reportCounterparty } from "../src/modules/moderation/service";
import type { ModerationAction, Target } from "../src/modules/moderation/contracts";
import { cleanupModerationFixtures } from "./moderation-test-cleanup";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: moderation requires TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12 }) });
  const users: string[] = [], companies: string[] = []; let stage = "fixtures", skillId = "";
  const reason = { reasonCode: "OTHER" as const, reason: "Reviewed fixture case" };
  async function actor(roles: Role[]) {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Moderation fixture", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const a: Principal = { id, name: "Moderation fixture", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER")) await saveEmployer(db, a, { type: "INDIVIDUAL", city: null, description: "" });
    if (roles.includes("WORKER")) await saveWorker(db, a, { headline: "Excel", bio: "", city: null, timezone: "Asia/Ho_Chi_Minh", preferences: ["FULL_TIME"], workModes: ["REMOTE"], skills: [{ skillId, level: "INTERMEDIATE" }], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] });
    return a;
  }
  async function denied(fn: () => Promise<unknown>, code: string) { await assert.rejects(fn, (e: unknown) => e instanceof AppError && e.code === code); }
  async function waitLock() {
    for (let i = 0; i < 150; i++) {
      const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`;
      if (row.n > 0n) return; await delay(20);
    }
    throw new Error("Lock wait not observed");
  }
  try {
    skillId = (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id;
    const owner = await actor(["EMPLOYER"]), worker = await actor(["WORKER"]), second = await actor(["WORKER"]), outsider = await actor(["WORKER"]), admin = await actor(["ADMIN"]), admin2 = await actor(["ADMIN"]);
    const input = { title: "Moderation race Excel", description: "Safe fixture work", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: null,
      compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 1, startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh",
      skills: [{ skillId, required: true, minimumLevel: "BEGINNER" }], schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    async function job(companyId: string | null = null) {
      const j = await createJob(db, owner, { ...input, companyId, creationKey: randomUUID() });
      return transitionJob(db, owner, j.id, "publish", { expectedVersion: j.version });
    }
    async function offer(jobId: string, a: Principal = worker) {
      const application = await applyToJob(db, a, jobId, { creationKey: randomUUID() });
      await actOnApplication(db, owner, application.id, "shortlist", {});
      const o = await createOffer(db, owner, application.id, { creationKey: randomUUID(), expiresAt: null });
      return { a: application, o };
    }
    async function makeCase(type: Target, targetId: string, reportId?: string) { return createCase(db, admin, { ...reason, targetType: type, targetId, severity: "HIGH", ...(reportId ? { reportId } : {}) }); }
    async function action(caseId: string, targetId: string, command: ModerationAction, a = admin) { return actOnCase(db, a, caseId, command, { ...reason, targetId }); }
    const j = await job(), hiring = await offer(j.id); await offer(j.id, second);
    const waitingApp = await applyToJob(db, outsider, j.id, { creationKey: randomUUID() });
    await actOnApplication(db, owner, waitingApp.id, "shortlist", {});
    stage = "reports, duplicates, privacy and case binding";
    const r = await createReport(db, worker, { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: "<script>fixture</script>" });
    const duplicate = await Promise.all([createReport(db, worker, { targetType: "JOB", targetId: j.id, reasonCode: "SCAM", details: null }), createReport(db, worker, { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: null })]);
    assert(duplicate.every((d) => d.id === r.id));
    assert(!JSON.stringify(r).includes("reporterUserId")); assert(!JSON.stringify(r).includes("details"));
    assert.equal((await listOwnReports(db, outsider, {})).items.length, 0);
    await denied(() => createReport(db, worker, { targetType: "JOB", targetId: randomUUID(), reasonCode: "SPAM", details: null }), "NOT_FOUND");
    await denied(() => listAdminReports(db, owner, {}), "FORBIDDEN");
    const c = await makeCase("JOB", j.id, r.id);
    assert.equal((await caseReports(db, admin, c.id, {})).items[0].details, "<script>fixture</script>");
    assert.equal((await listOwnReports(db, worker, {})).items[0].status, "IN_REVIEW");
    await denied(() => action(c.id, randomUUID(), "hide-job"), "CONFLICT");
    await denied(() => action(c.id, j.id, "hide-review"), "CONFLICT");
    await denied(() => caseDetail(db, outsider, c.id), "FORBIDDEN");
    const eventCount = await db.auditEvent.count();
    await denied(() => attachReport(db, admin, c.id, { ...reason, reportId: r.id }), "CONFLICT");
    assert.equal(await db.auditEvent.count(), eventCount);
    stage = "hidden jobs, FTS, matching and pending acceptance";
    await action(c.id, j.id, "hide-job");
    await denied(() => getPublicJob(db, j.id), "NOT_FOUND");
    assert(!(await listPublicJobs(db, { q: "Moderation" })).items.some((x) => x.id === j.id));
    assert(!(await recommendedJobs(db, outsider, {})).items.some((x) => x.id === j.id));
    await denied(() => recommendedCandidates(db, owner, j.id, {}), "CONFLICT");
    await denied(() => applyToJob(db, outsider, j.id, { creationKey: randomUUID() }), "CONFLICT");
    await denied(() => actOnOffer(db, worker, hiring.o.id, "accept", {}), "CONFLICT");
    await denied(() => createOffer(db, owner, waitingApp.id, { creationKey: randomUUID(), expiresAt: null }), "CONFLICT");
    assert.equal(await db.offer.count({ where: { applicationId: waitingApp.id } }), 0);
    await action(c.id, j.id, "unhide-job");
    assert.equal((await getPublicJob(db, j.id)).id, j.id);
    const accepted = await actOnOffer(db, worker, hiring.o.id, "accept", {}), e = accepted.engagement!;
    const original = await db.engagement.findUniqueOrThrow({ where: { id: e.id } });
    const force = await makeCase("ENGAGEMENT", e.id);
    await denied(() => action(force.id, e.id, "force-complete"), "CONFLICT");
    await actOnEngagement(db, owner, "EMPLOYER", e.id, "start", {});
    const chat = await openConversation(db, worker, "WORKER", hiring.a.id, {});
    const message = await sendMessage(db, worker, "WORKER", chat.id, { body: "Case-bound reported message", creationKey: randomUUID() });
    stage = "private message reports and audited single-message context";
    await denied(() => createReport(db, outsider, { targetType: "MESSAGE", targetId: message.id, reasonCode: "HARASSMENT", details: null }), "NOT_FOUND");
    const mr = await createReport(db, worker, { targetType: "MESSAGE", targetId: message.id, reasonCode: "HARASSMENT", details: null });
    const mc = await makeCase("MESSAGE", message.id, mr.id);
    const context = await inspectCase(db, admin, mc.id, reason);
    assert.equal(context && "body" in context ? context.body : null, "Case-bound reported message");
    assert(!JSON.stringify(context).includes("senderUserId"));
    stage = "force completion, immutable terms, no fake worker request and terminal chat";
    await action(force.id, e.id, "force-complete");
    const completed = await db.engagement.findUniqueOrThrow({ where: { id: e.id } });
    assert.equal(completed.status, "COMPLETED"); assert(completed.completedAt); assert.equal(completed.completionRequestedAt, null); assert.deepEqual(completed.terms, original.terms);
    assert.equal((await getConversation(db, worker, "WORKER", chat.id)).messagingAllowed, false);
    await denied(() => action(force.id, e.id, "force-cancel"), "CONFLICT");
    await denied(() => action(force.id, e.id, "force-complete"), "CONFLICT");
    const review = await submitReview(db, owner, "EMPLOYER", e.id, { rating: 5, comment: "Immutable review", creationKey: randomUUID() });
    stage = "review hide/unhide reputation, matching and historical apply snapshot";
    const wp = await db.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    await setDiscoverable(db, worker, wp.id, { discoverable: true });
    const snapshot = await db.application.findUniqueOrThrow({ where: { id: hiring.a.id } });
    const rc = await makeCase("REVIEW", review.id);
    const rating = async () => db.$transaction(async (tx) => (await getWorkerReputationFacts(tx, [wp.id])).get(wp.id)!);
    assert.equal((await rating()).ratingCount, 1);
    const beforeMatch = (await recommendedCandidates(db, owner, j.id, {})).items.find((x) => x.id === wp.id)!;
    const hideRace = await Promise.all([action(rc.id, review.id, "hide-review"), rating()]);
    assert([0, 1].includes(hideRace[1].ratingCount));
    assert.equal((await rating()).ratingCount, 0); assert.equal((await getEngagementReviews(db, worker, "WORKER", e.id)).items.length, 0);
    const hiddenMatch = (await recommendedCandidates(db, owner, j.id, {})).items.find((x) => x.id === wp.id)!;
    assert.equal(beforeMatch.match.coverage - hiddenMatch.match.coverage, 5);
    await assert.rejects(() => db.review.update({ where: { id: review.id }, data: { rating: 1 } }));
    await assert.rejects(() => db.review.update({ where: { id: review.id }, data: { hiddenAt: null } }));
    await action(rc.id, review.id, "unhide-review"); assert.equal((await rating()).ratingCount, 1);
    assert.deepEqual((await db.application.findUniqueOrThrow({ where: { id: hiring.a.id } })).matchScoreAtApply, snapshot.matchScoreAtApply);
    assert.equal((await db.review.findUniqueOrThrow({ where: { id: review.id } })).comment, "Immutable review");
    await progressCase(db, admin, rc.id, "close", { ...reason, resolutionCode: "RESOLVED" });
    await denied(() => action(rc.id, review.id, "hide-review"), "CONFLICT");
    stage = "audit immutable, complete, bounded and rollback";
    const events = await db.auditEvent.findMany({ where: { caseId: c.id } });
    assert(events.some((a) => a.action === "JOB_HIDDEN" && a.adminUserId === admin.id));
    await assert.rejects(() => db.auditEvent.update({ where: { id: events[0].id }, data: { reason: "Rewrite" } }));
    await assert.rejects(() => db.auditEvent.delete({ where: { id: events[0].id } }));
    const auditBefore = await db.auditEvent.count({ where: { caseId: c.id } });
    await assert.rejects(() => db.$transaction(async (tx) => { await tx.auditEvent.create({ data: { adminUserId: admin.id, caseId: c.id, resourceType: "JOB", resourceId: j.id, action: "JOB_HIDDEN", ...reason, metadata: {} } }); }));
    assert.equal(await db.auditEvent.count({ where: { caseId: c.id } }), auditBefore);
    const timeline = await caseTimeline(db, admin, c.id, { limit: 1 }); assert.equal(timeline.items.length, 1); assert(timeline.nextCursor);
    await denied(() => caseTimeline(db, admin, force.id, { cursor: timeline.items[0].id }), "VALIDATION");
    await denied(() => listCases(db, admin, { limit: 51 }), "VALIDATION");
    await progressCase(db, admin, c.id, "close", { ...reason, resolutionCode: "DISMISSED" });
    assert.equal((await listOwnReports(db, worker, {})).items.find((x) => x.id === r.id)!.status, "DISMISSED");
    assert.notEqual((await createReport(db, worker, { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: null })).id, r.id);
    stage = "fresh admin status/role and account semantics";
    const uc = await makeCase("USER", outsider.id);
    await action(uc.id, outsider.id, "suspend");
    await denied(() => createReport(db, outsider, { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: null }), "FORBIDDEN");
    await action(uc.id, outsider.id, "unsuspend");
    await db.userRole.delete({ where: { userId_role: { userId: admin2.id, role: "ADMIN" } } });
    await denied(() => action(uc.id, outsider.id, "ban", admin2), "FORBIDDEN");
    await db.userRole.create({ data: { userId: admin2.id, role: "ADMIN", grantedBy: "test-fixture" } });
    await db.user.update({ where: { id: admin2.id }, data: { status: "SUSPENDED" } });
    await denied(() => listCases(db, admin2, {}), "FORBIDDEN");
    await db.user.update({ where: { id: admin2.id }, data: { status: "BANNED" } });
    await denied(() => listCases(db, admin2, {}), "FORBIDDEN");
    await action(uc.id, outsider.id, "ban");
    await denied(() => action(uc.id, outsider.id, "unsuspend"), "CONFLICT");
    stage = "force cancellation capacity race";
    // Complete work occupies capacity, so use a second Job and two pending Offers.
    await transitionJob(db, owner, j.id, "close", { expectedVersion: (await db.job.findUniqueOrThrow({ where: { id: j.id } })).version });
    const j2 = await job(), h2 = await offer(j2.id), p2 = await offer(j2.id, second);
    const accepted2 = await actOnOffer(db, worker, h2.o.id, "accept", {}), e2 = accepted2.engagement!;
    const cancelTerms = (await db.engagement.findUniqueOrThrow({ where: { id: e2.id } })).terms;
    const fc = await makeCase("ENGAGEMENT", e2.id);
    const outcomes = await Promise.allSettled([action(fc.id, e2.id, "force-cancel"), actOnOffer(db, second, p2.o.id, "accept", {})]);
    assert.equal(outcomes[0].status, "fulfilled");
    if (outcomes[1].status === "rejected") await actOnOffer(db, second, p2.o.id, "accept", {});
    assert.equal(await db.engagement.count({ where: { jobId: j2.id, status: { in: ["ACCEPTED", "IN_PROGRESS", "COMPLETED"] } } }), 1);
    const cancelled = await db.engagement.findUniqueOrThrow({ where: { id: e2.id } }); assert.equal(cancelled.cancelledBy, null); assert(cancelled.moderationAuditId); assert.deepEqual(cancelled.terms, cancelTerms);
    stage = "suspension lock races and active obligation exceptions";
    const workerCase = await makeCase("USER", worker.id);
    async function suspensionWins(target: Principal, targetCase: string, operation: () => Promise<unknown>) {
      let queued!: Promise<unknown>;
      await db.$transaction(async (tx) => {
        for (const id of [admin.id, target.id].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR NO KEY UPDATE`;
        await currentActor(tx, admin, "ADMIN", true);
        await lockModerationAccountScopes(tx, target.id);
        queued = operation().catch((error: unknown) => error);
        await waitLock();
        const event = await tx.auditEvent.create({ data: { adminUserId: admin.id, caseId: targetCase, resourceType: "USER", resourceId: target.id, action: "USER_SUSPENDED", ...reason, metadata: {} } });
        await moderateAccount(tx, target.id, "suspend", event.id);
      }, { timeout: 15000 });
      const error = await queued; assert(error instanceof AppError && error.code === "FORBIDDEN");
      await action(targetCase, target.id, "unsuspend");
    }
    const raceJob = await job();
    await suspensionWins(worker, workerCase.id, () => applyToJob(db, worker, raceJob.id, { creationKey: randomUUID() }));
    const raceOffer = await offer(raceJob.id);
    const preWorkChat = await openConversation(db, worker, "WORKER", raceOffer.a.id, {});
    await suspensionWins(worker, workerCase.id, () => sendMessage(db, worker, "WORKER", preWorkChat.id, { body: "Queued recruiting", creationKey: randomUUID() }));
    const ownerCase = await makeCase("USER", owner.id);
    const raceDraft = await createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID() });
    await suspensionWins(owner, ownerCase.id, () => transitionJob(db, owner, raceDraft.id, "publish", { expectedVersion: raceDraft.version }));
    stage = "hide versus Apply and publish lock races";
    async function hideWins(targetId: string, operation: () => Promise<unknown>) {
      const boundCase = await makeCase("JOB", targetId); let queued!: Promise<unknown>;
      await db.$transaction(async (tx) => {
        await currentActor(tx, admin, "ADMIN", true, true);
        await lockModerationJob(tx, targetId);
        queued = operation().catch((error: unknown) => error); await waitLock();
        await tx.$queryRaw`SELECT id FROM "ModerationCase" WHERE id=${boundCase.id} FOR UPDATE`;
        const event = await tx.auditEvent.create({ data: { adminUserId: admin.id, caseId: boundCase.id, resourceType: "JOB", resourceId: targetId, action: "JOB_HIDDEN", ...reason, metadata: {} } });
        await moderateJob(tx, targetId, true, event.id, new Date());
      }, { timeout: 15000 });
      const error = await queued; assert(error instanceof AppError && error.code === "CONFLICT");
      await action(boundCase.id, targetId, "unhide-job");
    }
    await hideWins(raceJob.id, () => applyToJob(db, second, raceJob.id, { creationKey: randomUUID() }));
    await hideWins(raceDraft.id, () => transitionJob(db, owner, raceDraft.id, "publish", { expectedVersion: raceDraft.version }));
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: raceDraft.id } })).status, "DRAFT");
    await transitionJob(db, owner, raceJob.id, "close", { expectedVersion: (await db.job.findUniqueOrThrow({ where: { id: raceJob.id } })).version });
    stage = "report rate limiting and duplicate retry budget";
    const rateTargets: string[] = [];
    for (let i = 0; i < 11; i++) rateTargets.push((await createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID() })).id);
    for (const targetId of rateTargets.slice(0, 10)) await createReport(db, owner, { targetType: "JOB", targetId, reasonCode: "SPAM", details: null });
    await createReport(db, owner, { targetType: "JOB", targetId: rateTargets[0], reasonCode: "SPAM", details: null });
    await denied(() => createReport(db, owner, { targetType: "JOB", targetId: rateTargets[10], reasonCode: "SPAM", details: null }), "RATE_LIMITED");
    stage = "review suspension lock race and active obligation exceptions";
    // Hold actual target User lock; queue review, commit audited suspension, then observe fresh denial.
    let waiting!: Promise<unknown>;
    await db.$transaction(async (tx) => {
      await currentActor(tx, admin, "ADMIN", true, true);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${worker.id} FOR NO KEY UPDATE`;
      waiting = submitReview(db, worker, "WORKER", e.id, { rating: 4, comment: null, creationKey: randomUUID() }).catch((err: unknown) => err);
      await waitLock();
      const a = await tx.auditEvent.create({ data: { adminUserId: admin.id, caseId: workerCase.id, resourceType: "USER", resourceId: worker.id, action: "USER_SUSPENDED", ...reason, metadata: {} } });
      await moderateAccount(tx, worker.id, "suspend", a.id);
    }, { timeout: 15000 });
    const error = await waiting; assert(error instanceof AppError && error.code === "FORBIDDEN");
    await action(workerCase.id, worker.id, "unsuspend");
    const secondCase = await makeCase("USER", second.id);
    await action(secondCase.id, second.id, "suspend");
    const activeSecond = await db.engagement.findFirstOrThrow({ where: { jobId: j2.id, status: "ACCEPTED" } });
    await actOnEngagement(db, owner, "EMPLOYER", activeSecond.id, "start", {});
    await actOnEngagement(db, second, "WORKER", activeSecond.id, "request-completion", {});
    const dispute = await createReport(db, second, { targetType: "ENGAGEMENT", targetId: activeSecond.id, reasonCode: "OTHER", details: "Active obligation dispute" }); assert(dispute.id);
    const activeChat = await openConversation(db, second, "WORKER", p2.a.id, {});
    await sendMessage(db, second, "WORKER", activeChat.id, { body: "Required active obligation", creationKey: randomUUID() });
    await action(secondCase.id, second.id, "ban");
    await denied(() => listMessages(db, second, "WORKER", activeChat.id, {}), "FORBIDDEN");
    assert(await db.engagement.findUnique({ where: { id: activeSecond.id } }));
    stage = "ban owner visibility and Company ownership independence";
    const company = await createCompany(db, owner, { name: "Moderation Company", city: null, description: "", website: null, creationKey: randomUUID() }); companies.push(company.id);
    const manager = await actor(["EMPLOYER"]);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    const companyJob = await job(company.id);
    const companyHiring = await offer(companyJob.id);
    const companyCase = await makeCase("JOB", companyJob.id);
    await action(companyCase.id, companyJob.id, "hide-job");
    await denied(() => getPublicJob(db, companyJob.id), "NOT_FOUND");
    await action(companyCase.id, companyJob.id, "unhide-job");
    stage = "current Company membership vs contextual report lock race";
    let revokedReport!: Promise<unknown>;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${company.id} FOR UPDATE`;
      revokedReport = reportCounterparty(db, manager, { applicationId: companyHiring.a.id, side: "EMPLOYER" }, { reasonCode: "SPAM", details: null }).catch((error: unknown) => error);
      await waitLock();
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: manager.id } } });
    }, { timeout: 15000 });
    const revoked = await revokedReport; assert(revoked instanceof AppError && revoked.code === "NOT_FOUND");
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    stage = "ban visibility independent of Company creator";
    await action(ownerCase.id, owner.id, "ban");
    await denied(() => getPublicJob(db, j2.id), "NOT_FOUND");
    assert.equal((await getPublicJob(db, companyJob.id)).id, companyJob.id);
    const managerCase = await makeCase("USER", manager.id); await action(managerCase.id, manager.id, "ban");
    await denied(() => getPublicJob(db, companyJob.id), "NOT_FOUND");
    console.log("PASS: moderation reports/cases/privacy/admin/audit/visibility/reputation/force/capacity/status locks and active obligations.");
  } catch { console.error(`FAIL: moderation integration at ${stage}.`); process.exitCode = 1; }
  finally {
    try {
      await cleanupModerationFixtures(db, users);
      await db.notification.deleteMany({ where: { userId: { in: users } } });
      await db.conversationReadState.deleteMany({ where: { userId: { in: users } } });
      await db.message.deleteMany({ where: { senderUserId: { in: users } } });
      await db.conversation.deleteMany({ where: { worker: { userId: { in: users } } } });
      await db.review.deleteMany({ where: { reviewerUserId: { in: users } } });
      await db.engagement.deleteMany({ where: { worker: { userId: { in: users } } } });
      await db.offer.deleteMany({ where: { job: { createdByUserId: { in: users } } } });
      await db.application.deleteMany({ where: { worker: { userId: { in: users } } } });
      await db.jobSkill.deleteMany({ where: { job: { createdByUserId: { in: users } } } });
      await db.jobScheduleWindow.deleteMany({ where: { job: { createdByUserId: { in: users } } } });
      await db.job.deleteMany({ where: { createdByUserId: { in: users } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } });
      await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } });
      await db.rateLimit.deleteMany({ where: { OR: users.flatMap((id) => [{ key: { startsWith: `message:user:${id}` } }, { key: { startsWith: `message:conversation:${id}:` } }]) } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: moderation fixture cleanup."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
