import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type JobStatus } from "../src/generated/prisma/client";
import { testDatabase } from "./test-database";
import { cleanupModerationFixtures } from "./moderation-test-cleanup";
import type { Principal, Role } from "../src/modules/auth/policy";
import { AppError } from "../src/shared/errors/app-error";
import { safeFailure } from "../src/modules/auth/http";
import { saveEmployer, saveWorker } from "../src/modules/profiles/service";
import { createJob, transitionJob } from "../src/modules/jobs/service";
import { applyToJob, actOnApplication, createOffer, actOnOffer, actOnEngagement } from "../src/modules/hiring/service";
import { openConversation, sendMessage } from "../src/modules/messaging/service";
import { submitReview } from "../src/modules/reviews/service";
import { createReport, createCase, actOnCase } from "../src/modules/moderation/service";
import { adminAnalytics } from "../src/modules/analytics/service";
import { defaultRange } from "../src/modules/analytics/contracts";
import { withTelemetry, type Telemetry } from "../src/shared/observability/runtime";
import type { ProductEvent } from "../src/shared/observability/contracts";
import { transaction } from "../src/shared/db/transaction";
import { committedEvent } from "../src/shared/observability/commit";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: analytics needs explicit disposable TEST_DATABASE_URL."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = testDatabase(process.env);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 8 }), log: [{ level: "query", emit: "event" }] });
  const users: string[] = [], events: ProductEvent[] = [];
  let stage = "fixtures", queryCount = 0;
  db.$on("query", () => queryCount++);
  const providers: Telemetry = { analytics: { async capture(event) {
    // Independent committed reads: a provider can never observe a rolled-back write.
    if (event.name === "application_created") assert.ok(await db.application.findUnique({ where: { id: event.resourceId } }));
    if (event.name === "message_sent") assert.ok(await db.message.findUnique({ where: { id: event.resourceId } }));
    events.push(event);
  } }, errors: { async captureException() {} }, monitoring: { async observe() {} } };
  const denied = async (work: () => Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => error instanceof AppError && error.code === code);
  try {
    const skillId = (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id;
    async function actor(roles: Role[]) {
      const id = randomUUID(); users.push(id);
      await db.user.create({ data: { id, name: "Analytics fixture", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "analytics-fixture" })) } } });
      const p: Principal = { id, name: "Analytics fixture", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
      if (roles.includes("EMPLOYER")) await saveEmployer(db, p, { type: "INDIVIDUAL", description: "", city: null });
      if (roles.includes("WORKER")) await saveWorker(db, p, { headline: "Excel", bio: "", city: null, preferences: ["FULL_TIME"], workModes: ["REMOTE"], skills: [{ skillId, level: "INTERMEDIATE" }], availability: [] });
      return p;
    }
    const owner = await actor(["EMPLOYER"]), worker = await actor(["WORKER"]), worker2 = await actor(["WORKER"]), admin = await actor(["ADMIN"]);
    const input = { title: "Analytics fixture", description: "Synthetic work", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: null,
      compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2, startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId, required: true, minimumLevel: "BEGINNER" }], schedule: [] };
    const reason = { reasonCode: "OTHER" as const, reason: "Synthetic moderation review" };
    const currentRange = defaultRange();
    const before = await adminAnalytics(db, admin, currentRange);
    stage = "committed lifecycle conversion and idempotency";
    await withTelemetry(providers, async () => {
      const draftInput = { ...input, companyId: null, creationKey: randomUUID() };
      const j = await createJob(db, owner, draftInput); await createJob(db, owner, draftInput);
      const published = await transitionJob(db, owner, j.id, "publish", { expectedVersion: j.version });
      const first = (await db.job.findUniqueOrThrow({ where: { id: j.id } })).publishedAt;
      const paused = await transitionJob(db, owner, j.id, "pause", { expectedVersion: published.version });
      await transitionJob(db, owner, j.id, "resume", { expectedVersion: paused.version });
      assert.equal((await db.job.findUniqueOrThrow({ where: { id: j.id } })).publishedAt?.getTime(), first?.getTime());
      const key = randomUUID(); const a = await applyToJob(db, worker, j.id, { creationKey: key });
      await applyToJob(db, worker, j.id, { creationKey: key });
      stage = "open conversation"; const c = await openConversation(db, worker, "WORKER", a.id, {});
      const message = { creationKey: randomUUID(), body: "Private message must not reach telemetry" };
      stage = "send message"; await sendMessage(db, worker, "WORKER", c.id, message); stage = "send message"; await sendMessage(db, worker, "WORKER", c.id, message);
      const offerInput = { creationKey: randomUUID(), expiresAt: null };
      await actOnApplication(db, owner, a.id, "shortlist", {});
      stage = "create offer"; const offer = await createOffer(db, owner, a.id, offerInput); await createOffer(db, owner, a.id, offerInput);
      await actOnOffer(db, worker, offer.id, "decline", {});
      const revised = await createOffer(db, owner, a.id, { creationKey: randomUUID(), expiresAt: null });
      stage = "accept offer"; await actOnOffer(db, worker, revised.id, "accept", {}); await actOnOffer(db, worker, revised.id, "accept", {});
      const e = await db.engagement.findUniqueOrThrow({ where: { applicationId: a.id } });
      stage = "start organic"; await actOnEngagement(db, owner, "EMPLOYER", e.id, "start", {});
      await actOnEngagement(db, worker, "WORKER", e.id, "request-completion", {}); await actOnEngagement(db, worker, "WORKER", e.id, "request-completion", {});
      await actOnEngagement(db, owner, "EMPLOYER", e.id, "confirm-completion", {});
      const review = { creationKey: randomUUID(), rating: 5, comment: "Private review must not reach telemetry" };
      await submitReview(db, worker, "WORKER", e.id, review); await submitReview(db, worker, "WORKER", e.id, review);
      stage = "report"; const report = { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: "Private report must not reach telemetry" };
      await createReport(db, worker, report); await createReport(db, worker, report);
      stage = "second engagement"; const a2 = await applyToJob(db, worker2, j.id, { creationKey: randomUUID() });
      await actOnApplication(db, owner, a2.id, "shortlist", {});
      const o2 = await createOffer(db, owner, a2.id, { creationKey: randomUUID(), expiresAt: null });
      await actOnOffer(db, worker2, o2.id, "accept", {});
      const e2 = await db.engagement.findUniqueOrThrow({ where: { applicationId: a2.id } });
      await actOnEngagement(db, owner, "EMPLOYER", e2.id, "start", {});
      const bound = await createCase(db, admin, { ...reason, targetType: "ENGAGEMENT", targetId: e2.id, severity: "HIGH" });
      await actOnCase(db, admin, bound.id, "force-complete", { ...reason, targetId: e2.id });
      assert.equal((await db.engagement.findUniqueOrThrow({ where: { id: e2.id } })).completionRequestedAt, null);
      stage = "metric classification"; const after = await adminAnalytics(db, admin, currentRange);
      assert.equal(after.activity.completedTotal - before.activity.completedTotal, 2);
      assert.equal(after.activity.completedOrganic - before.activity.completedOrganic, 1);
      assert.equal(after.activity.completedForced - before.activity.completedForced, 1);
      assert.equal(after.applicationCohort.accepted - before.applicationCohort.accepted, 2);
      assert.equal(after.applicationCohort.offered - before.applicationCohort.offered, 2); // Three Offer revisions, only two Applications.
      assert.equal(after.applicationCohort.completedForced - before.applicationCohort.completedForced, 1);
      stage = "conversion counts"; for (const name of ["job_created", "message_sent", "review_submitted", "report_created", "completion_requested", "moderation_action_applied"]) assert.equal(events.filter((e) => e.name === name).length, 1, name);
      for (const name of ["application_created", "offer_accepted", "engagement_created", "engagement_completed"]) assert.equal(events.filter((e) => e.name === name).length, 2, name);
      assert.equal(events.filter((e) => e.name === "offer_created").length, 3);
      assert.equal(new Set(events.map((e) => e.eventKey)).size, events.length);
      const serialized = JSON.stringify(events);
      for (const secret of [worker.email, owner.email, message.body, review.comment, report.details, reason.reason, "actorId", "adminUserId", "reporterUserId"]) assert.ok(!serialized.includes(secret));
    });
    stage = "forced cancellation and provider failure across committed hiring/admin actions";
    const beforeCancel = await adminAnalytics(db, admin, currentRange);
    await withTelemetry({ ...providers, analytics: { async capture(event) { events.push(event); throw new Error("Unavailable provider"); } } }, async () => {
      const j = await createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID() });
      await transitionJob(db, owner, j.id, "publish", { expectedVersion: j.version });
      const a = await applyToJob(db, worker, j.id, { creationKey: randomUUID() });
      await actOnApplication(db, owner, a.id, "shortlist", {});
      const o = await createOffer(db, owner, a.id, { creationKey: randomUUID(), expiresAt: null });
      await actOnOffer(db, worker, o.id, "accept", {});
      const e = await db.engagement.findUniqueOrThrow({ where: { applicationId: a.id } });
      const c = await createCase(db, admin, { ...reason, targetType: "ENGAGEMENT", targetId: e.id, severity: "HIGH" });
      await actOnCase(db, admin, c.id, "force-cancel", { ...reason, targetId: e.id });
      assert.equal((await db.engagement.findUniqueOrThrow({ where: { id: e.id } })).status, "CANCELLED");
      assert.ok(events.some((event) => event.name === "engagement_cancelled" && event.resourceId === e.id && event.properties.provenance === "ADMIN_FORCED"));
    });
    const afterCancel = await adminAnalytics(db, admin, currentRange);
    assert.equal(afterCancel.applicationCohort.cancelledForced - beforeCancel.applicationCohort.cancelledForced, 1);
    assert.equal(afterCancel.applicationCohort.cancelledParticipant - beforeCancel.applicationCohort.cancelledParticipant, 0);
    assert.equal(afterCancel.activity.completedTotal, beforeCancel.activity.completedTotal);
    stage = "rollback and confirmed-abort retry discard events";
    await withTelemetry(providers, async () => {
      const n = events.length; const failure = new Error("rollback");
      await assert.rejects(() => transaction(db, async (tx) => { committedEvent(tx, { name: "job_created", resourceId: randomUUID(), actorRole: "EMPLOYER", properties: {} }); throw failure; }), (e) => e === failure);
      assert.equal(events.length, n);
      let attempts = 0; const resourceId = randomUUID();
      await transaction(db, async (tx) => { attempts++; committedEvent(tx, { name: "job_created", resourceId, actorRole: "EMPLOYER", properties: {} });
        if (attempts === 1) await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'test abort' USING ERRCODE='40001'; END $$`; });
      assert.equal(attempts, 2); assert.equal(events.length, n + 1);
    });
    stage = "provider throw/hang never changes committed domain state";
    for (const mode of ["throw", "hang"] as const) {
      const p: Telemetry = { ...providers, analytics: { capture: mode === "throw" ? async () => { throw new Error("provider private data"); } : async () => new Promise<void>(() => {}) } };
      const j = await withTelemetry(p, () => createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID() }));
      assert.ok(await db.job.findUnique({ where: { id: j.id } }));
    }
    stage = "only INTERNAL boundary failures monitored";
    let captured = 0;
    await withTelemetry({ ...providers, errors: { async captureException(error, ctx) { captured++; assert.equal(error.message, "Unexpected application failure"); assert.equal(ctx.code, "INTERNAL"); } } }, async () => {
      for (const code of ["VALIDATION", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "UNAUTHENTICATED"] as const) await safeFailure(new AppError(code));
      assert.equal(captured, 0); await safeFailure(new Error("SQL token email@example.invalid")); assert.equal(captured, 1);
    });
    stage = "fresh ADMIN and strict bounded range";
    for (const p of [owner, worker]) await denied(() => adminAnalytics(db, p, currentRange), "FORBIDDEN");
    await db.user.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } }); await denied(() => adminAnalytics(db, admin, currentRange), "FORBIDDEN");
    await db.user.update({ where: { id: admin.id }, data: { status: "ACTIVE" } });
    await db.userRole.delete({ where: { userId_role: { userId: admin.id, role: "ADMIN" } } }); await denied(() => adminAnalytics(db, admin, currentRange), "FORBIDDEN");
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedBy: "analytics-fixture" } });
    await denied(() => adminAnalytics(db, admin, { ...currentRange, userId: worker.id }), "VALIDATION");
    await denied(() => adminAnalytics(db, { ...admin, id: randomUUID() }, currentRange), "UNAUTHENTICATED");
    stage = "24h liquidity historical snapshot and timestamp boundaries";
    const employerProfileId = (await db.employerProfile.findUniqueOrThrow({ where: { userId: owner.id } })).id;
    const workerIds = await db.workerProfile.findMany({ where: { userId: { in: [worker.id, worker2.id] } }, select: { id: true } });
    const third = await actor(["WORKER"]); workerIds.push({ id: (await db.workerProfile.findUniqueOrThrow({ where: { userId: third.id } })).id });
    const firstPublished = new Date("2001-01-10T00:00:00Z");
    const range = { start: "2001-01-01T00:00:00Z", end: "2001-02-01T00:00:00Z" };
    const baseline = await adminAnalytics(db, admin, range);
    async function historical(status: JobStatus = "CLOSED", cancelMinutes = 10, at = firstPublished) {
      return db.job.create({ data: { id: randomUUID(), employerProfileId, createdByUserId: owner.id, creationKey: randomUUID(), title: "Historical synthetic cohort", status,
        publishedAt: status === "DRAFT" ? null : at, closedAt: status === "CLOSED" ? at : null, cancelledAt: status === "CANCELLED" ? new Date(at.getTime() + cancelMinutes * 60000) : null } });
    }
    async function applications(jobId: string, options: { thirdMs?: number; score?: number; coverage?: number; legacy?: boolean; algorithm?: string } = {}) {
      for (let i = 0; i < 3; i++) await db.application.create({ data: { jobId, workerProfileId: workerIds[i].id, creationKey: randomUUID(),
        appliedAt: new Date(firstPublished.getTime() + (i === 2 ? options.thirdMs ?? 86400000 : 60000 * (i + 1))),
        ...(options.legacy ? {} : { matchEligibleAtApply: true, matchScoreAtApply: options.score ?? 70, matchCoverageAtApply: options.coverage ?? 60, matchWeightsVersion: "v1", matchAlgorithmVersion: options.algorithm ?? "deterministic-v2", matchedAt: firstPublished }) } });
    }
    await historical("DRAFT");
    for (const ms of [86399000, 86400000, 86400001]) { const j = await historical(); await applications(j.id, { thirdMs: ms }); }
    for (const options of [{ score: 69 }, { coverage: 59 }, { legacy: true }, { algorithm: "deterministic-v1" }]) { const j = await historical(); await applications(j.id, options); }
    await historical("PAUSED"); // Poor-performing paused/closed rows cannot vanish.
    await historical("CANCELLED", 5); // Zero applications: excluded, inclusive 5m.
    await historical("CANCELLED", 5.001); // Just beyond threshold: retained.
    const earlyWithApps = await historical("CANCELLED", 1); await applications(earlyWithApps.id);
    await historical("CLOSED", 10, new Date(range.end)); // End exclusive.
    await historical("CLOSED", 10, new Date(range.start)); // Start inclusive.
    const result = await adminAnalytics(db, admin, range);
    assert.equal(result.activity.publishedJobs - baseline.activity.publishedJobs, 12);
    assert.equal(result.liquidity.jobsEligibleFor24hLiquidity - baseline.liquidity.jobsEligibleFor24hLiquidity, 11);
    assert.equal(result.liquidity.jobsWith3RelevantApplicants24h - baseline.liquidity.jobsWith3RelevantApplicants24h, 4);
    assert.equal(result.liquidity.excludedEarlyCancelledJobs - baseline.liquidity.excludedEarlyCancelledJobs, 1);
    const snapshot = JSON.stringify(result);
    await db.workerProfile.updateMany({ where: { id: { in: workerIds.map((r) => r.id) } }, data: { headline: "Changed after historical application" } });
    const afterEdit = await adminAnalytics(db, admin, range); assert.equal(JSON.stringify({ ...afterEdit, asOf: result.asOf }), snapshot);
    const hiddenJob = await historical();
    const hiddenCase = await createCase(db, admin, { ...reason, targetType: "JOB", targetId: hiddenJob.id, severity: "HIGH" });
    await actOnCase(db, admin, hiddenCase.id, "hide-job", { ...reason, targetId: hiddenJob.id });
    assert.equal((await adminAnalytics(db, admin, range)).liquidity.jobsEligibleFor24hLiquidity, result.liquidity.jobsEligibleFor24hLiquidity + 1);
    const currentBefore = await adminAnalytics(db, admin, currentRange);
    await historical("PUBLISHED", 10, new Date(Date.now() - 3600000));
    const immature = await adminAnalytics(db, admin, currentRange);
    assert.equal(immature.activity.publishedJobs, currentBefore.activity.publishedJobs + 1);
    assert.equal(immature.liquidity.jobsEligibleFor24hLiquidity, currentBefore.liquidity.jobsEligibleFor24hLiquidity);
    const empty = await adminAnalytics(db, admin, { start: "2002-01-01T00:00:00Z", end: "2002-01-02T00:00:00Z" });
    assert.equal(empty.liquidity.rate.percent, null); assert.equal(empty.applicationCohort.acceptanceRate.percent, null);
    // Existing DB contract permits true or historical null only; false must fail closed.
    await assert.rejects(() => db.application.create({ data: { jobId: hiddenJob.id, workerProfileId: workerIds[0].id, creationKey: randomUUID(), matchEligibleAtApply: false,
      matchScoreAtApply: 100, matchCoverageAtApply: 100, matchWeightsVersion: "v1", matchAlgorithmVersion: "deterministic-v2", matchedAt: firstPublished } }));
    stage = "bounded aggregate query count on hundreds of rows";
    await db.job.createMany({ data: Array.from({ length: 300 }, () => ({ employerProfileId, createdByUserId: owner.id, creationKey: randomUUID(), title: "Synthetic closed no applicants", status: "CLOSED" as const, publishedAt: firstPublished, closedAt: firstPublished })) });
    queryCount = 0; const scale = await adminAnalytics(db, admin, range); const scaleQueries = queryCount;
    assert.equal(scale.liquidity.jobsEligibleFor24hLiquidity - result.liquidity.jobsEligibleFor24hLiquidity, 301);
    assert.ok(scaleQueries <= 8, `aggregate query count ${scaleQueries}`);
    const [plan] = await db.$queryRaw<{ "QUERY PLAN": unknown }[]>`EXPLAIN (ANALYZE, FORMAT JSON) SELECT j.id, (SELECT count(*) FROM "Application" a WHERE a."jobId"=j.id AND a."appliedAt"<=j."publishedAt"+interval '24 hours') FROM "Job" j WHERE j."publishedAt">=${new Date(range.start)} AND j."publishedAt"<${new Date(range.end)}`;
    assert.ok(plan["QUERY PLAN"]); console.info(`PASS: analytics 300-job aggregate uses ${scaleQueries} queries; real EXPLAIN executed (not a production SLA).`);
    console.info("PASS: analytics committed events/dedup/rollback/retry/provider isolation/privacy/fresh ADMIN/organic-forced/24h boundaries/immutable relevance/funnels.");
  } catch { console.error(`FAIL: analytics at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1; }
  finally {
    try {
      await cleanupModerationFixtures(db, users);
      const jobs = { createdByUserId: { in: users } }, apps = { job: jobs }, chats = { job: jobs };
      await db.notification.deleteMany({ where: { conversation: chats } }); await db.conversationReadState.deleteMany({ where: { conversation: chats } }); await db.message.deleteMany({ where: { conversation: chats } }); await db.conversation.deleteMany({ where: chats });
      await db.review.deleteMany({ where: { engagement: { job: jobs } } }); await db.engagement.deleteMany({ where: { job: jobs } }); await db.offer.deleteMany({ where: { application: apps } }); await db.application.deleteMany({ where: apps });
      await db.jobSkill.deleteMany({ where: { job: jobs } }); await db.jobScheduleWindow.deleteMany({ where: { job: jobs } }); await db.job.deleteMany({ where: jobs });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } }); await db.employerProfile.deleteMany({ where: { userId: { in: users } } }); await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
      await db.rateLimit.deleteMany({ where: { OR: users.flatMap((id) => [{ key: `job-draft:user:${id}` }, { key: `message:user:${id}` }, { key: { startsWith: `message:conversation:${id}:` } }]) } });
    } catch { console.error("FAIL: analytics owned fixture cleanup."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
