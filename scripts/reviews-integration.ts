import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Principal, Role } from "../src/modules/auth/policy";
import { AppError } from "../src/shared/errors/app-error";
import { testDatabase } from "./test-database";
import { saveEmployer, saveWorker, setDiscoverable } from "../src/modules/profiles/service";
import { createCompany } from "../src/modules/companies/service";
import { createJob, transitionJob } from "../src/modules/jobs/service";
import { actOnApplication, actOnEngagement, actOnOffer, applyToJob, createOffer } from "../src/modules/hiring/service";
import { getEngagementReviews, ownerReputationForPublicJob, ownerReviewsForJob, submitReview, workerReviewsForEmployer } from "../src/modules/reviews/service";
import { getOwnerReputationFacts, getWorkerReputationFacts } from "../src/modules/reviews/query";
import { reputationDto } from "../src/modules/reviews/contracts";
import { recommendedCandidates } from "../src/modules/matching/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: reviews require TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = testDatabase(process.env);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12 }), log: [{ level: "query", emit: "event" }] });
  let queryCount = 0; db.$on("query", () => { queryCount++; });
  const users: string[] = [], companies: string[] = []; let stage = "fixtures";
  let skillId = "";
  async function actor(roles: Role[]) {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Safe review display", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const a: Principal = { id, name: "Safe review display", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER")) await saveEmployer(db, a, { type: "INDIVIDUAL", city: null, description: "" });
    if (roles.includes("WORKER")) await saveWorker(db, a, { headline: "Excel", bio: "", city: null, timezone: "Asia/Ho_Chi_Minh", preferences: ["FULL_TIME"], workModes: ["REMOTE"], skills: [{ skillId, level: "INTERMEDIATE" }], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] });
    return a;
  }
  const body = (rating = 5, comment: string | null = "Completed work") => ({ rating, comment, creationKey: randomUUID() });
  async function denied(action: () => Promise<unknown>, code: string) { await assert.rejects(action, (e: unknown) => e instanceof AppError && e.code === code); }
  async function waitLock() {
    for (let i = 0; i < 150; i++) {
      const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`;
      if (row.n > 0n) return; await delay(20);
    }
    throw new Error("Lock wait not observed");
  }
  try {
    skillId = (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id;
    const owner = await actor(["EMPLOYER"]), manager = await actor(["EMPLOYER"]), worker = await actor(["WORKER"]), other = await actor(["WORKER", "EMPLOYER"]), admin = await actor(["ADMIN"]);
    const company = await createCompany(db, owner, { name: "Historical Company", city: null, description: "", website: null, creationKey: randomUUID() }); companies.push(company.id);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    const wp = await db.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    const ep = await db.employerProfile.findUniqueOrThrow({ where: { userId: owner.id } });
    const jobInput = { title: "Historical review job", description: "Completed real work", category: "FINANCE_ACCOUNTING" as const, employmentType: "FULL_TIME" as const, workMode: "REMOTE" as const, city: null,
      compensationType: "HOURLY" as const, compensationMin: "50000", compensationMax: "80000", currency: "VND" as const, headcount: 3, startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh",
      skills: [{ skillId, required: true, minimumLevel: "BEGINNER" as const }], schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    async function job(companyId: string | null = null) {
      const j = await createJob(db, owner, { ...jobInput, companyId, creationKey: randomUUID() });
      return transitionJob(db, owner, j.id, "publish", { expectedVersion: j.version });
    }
    async function work(companyId: string | null = null, terminal: "COMPLETED" | "WORKER_CANCELLED" | "EMPLOYER_CANCELLED" | "ACTIVE" = "COMPLETED") {
      const j = await job(companyId), a = await applyToJob(db, worker, j.id, { creationKey: randomUUID() });
      await actOnApplication(db, owner, a.id, "shortlist", {});
      const offered = await createOffer(db, owner, a.id, { creationKey: randomUUID(), expiresAt: null });
      await transitionJob(db, owner, j.id, "close", { expectedVersion: j.version });
      const accepted = await actOnOffer(db, worker, offered.id, "accept", {}); const e = accepted.engagement!;
      if (terminal === "COMPLETED") {
        await actOnEngagement(db, owner, "EMPLOYER", e.id, "start", {});
        await actOnEngagement(db, worker, "WORKER", e.id, "request-completion", {});
        await actOnEngagement(db, owner, "EMPLOYER", e.id, "confirm-completion", {});
      } else if (terminal !== "ACTIVE") await actOnEngagement(db, terminal === "WORKER_CANCELLED" ? worker : owner, terminal === "WORKER_CANCELLED" ? "WORKER" : "EMPLOYER", e.id, "cancel", { category: "OTHER", reason: "Fixture cancellation" });
      return { j, a, e };
    }
    const personal = await work(), owned = await work(company.id), active = await work(null, "ACTIVE"), cancelled = await work(null, "WORKER_CANCELLED");
    await work(null, "EMPLOYER_CANCELLED");
    stage = "eligibility, fresh role/status, IDOR and bilateral direction";
    await denied(() => submitReview(db, worker, "WORKER", active.e.id, body()), "CONFLICT");
    await denied(() => submitReview(db, worker, "WORKER", cancelled.e.id, body()), "CONFLICT");
    await actOnEngagement(db, owner, "EMPLOYER", active.e.id, "start", {});
    await denied(() => submitReview(db, owner, "EMPLOYER", active.e.id, body()), "CONFLICT");
    await denied(() => submitReview(db, other, "WORKER", personal.e.id, body()), "NOT_FOUND");
    await denied(() => submitReview(db, other, "EMPLOYER", personal.e.id, body()), "NOT_FOUND");
    await denied(() => submitReview(db, admin, "EMPLOYER", personal.e.id, body()), "FORBIDDEN");
    for (const status of ["SUSPENDED", "BANNED"] as const) {
      await db.user.update({ where: { id: worker.id }, data: { status } });
      await denied(() => submitReview(db, worker, "WORKER", personal.e.id, body()), "FORBIDDEN");
    }
    await db.user.update({ where: { id: worker.id }, data: { status: "ACTIVE" } });
    await db.userRole.delete({ where: { userId_role: { userId: worker.id, role: "WORKER" } } });
    await denied(() => submitReview(db, worker, "WORKER", personal.e.id, body()), "FORBIDDEN");
    await db.userRole.create({ data: { userId: worker.id, role: "WORKER", grantedBy: "fixture" } });
    await db.userBlock.create({ data: { blockerUserId: owner.id, blockedUserId: worker.id } });
    const pBody = body(4, "<script>plain</script>"), p = await submitReview(db, worker, "WORKER", personal.e.id, pBody);
    assert.equal((await submitReview(db, worker, "WORKER", personal.e.id, pBody)).id, p.id);
    await denied(() => submitReview(db, worker, "WORKER", personal.e.id, { ...pBody, rating: 3 }), "CONFLICT");
    await denied(() => submitReview(db, worker, "WORKER", personal.e.id, body()), "CONFLICT");
    const personalWorker = await submitReview(db, owner, "EMPLOYER", personal.e.id, body(1, null));
    await submitReview(db, worker, "WORKER", owned.e.id, body(5));
    stage = "Company-side concurrent submit and identity-safe snapshots";
    const raced = await Promise.allSettled([submitReview(db, owner, "EMPLOYER", owned.e.id, body(5)), submitReview(db, manager, "EMPLOYER", owned.e.id, body(5))]);
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(raced.some((r) => r.status === "rejected" && r.reason instanceof AppError && r.reason.code === "CONFLICT"));
    assert.equal(await db.review.count({ where: { engagementId: owned.e.id } }), 2);
    const same = await work(company.id), sameBody = body(3);
    const retries = await Promise.all([submitReview(db, worker, "WORKER", same.e.id, sameBody), submitReview(db, worker, "WORKER", same.e.id, sameBody)]);
    assert.equal(retries[0].id, retries[1].id);
    await db.company.update({ where: { id: company.id }, data: { name: "Renamed Company" } });
    await db.user.update({ where: { id: owner.id }, data: { name: "Renamed person" } });
    const safe = await getEngagementReviews(db, worker, "WORKER", owned.e.id);
    assert.ok(safe.items.some((r) => r.reviewerDisplay === "Historical Company"));
    for (const secret of [owner.id, worker.id, manager.id, owner.email, wp.id, ep.id, company.id, "reviewerUserId", "hiddenAt"]) assert.equal(JSON.stringify(safe).includes(secret), false);
    stage = "database rating, target, completed gate, uniqueness and immutable UPDATE";
    await assert.rejects(() => db.review.update({ where: { id: p.id }, data: { rating: 2 } }));
    const stored = await db.review.findUniqueOrThrow({ where: { id: p.id } });
    await assert.rejects(() => db.review.create({ data: { ...stored, id: randomUUID() } }));
    await assert.rejects(() => db.review.create({ data: { ...stored, id: randomUUID(), engagementId: same.e.id, rating: 6 } }));
    await assert.rejects(() => db.review.create({ data: { ...stored, id: randomUUID(), engagementId: active.e.id } }));
    await assert.rejects(() => db.review.create({ data: { ...stored, id: randomUUID(), engagementId: same.e.id, companyId: company.id, employerProfileId: null } }));
    stage = "exact aggregates, hidden exclusion, outcomes and target separation";
    const facts = await db.$transaction((tx) => getWorkerReputationFacts(tx, [wp.id]));
    assert.deepEqual(facts.get(wp.id), { ratingSum: 6, ratingCount: 2, completed: 3, relevantCancelled: 1 });
    assert.equal(reputationDto(facts.get(wp.id)!).reliability.score, 0.75);
    const personalFacts = await db.$transaction((tx) => getOwnerReputationFacts(tx, { companyId: null, employerProfileId: ep.id }));
    const companyFacts = await db.$transaction((tx) => getOwnerReputationFacts(tx, { companyId: company.id, employerProfileId: ep.id }));
    assert.equal(personalFacts.ratingSum, 4); assert.equal(personalFacts.ratingCount, 1); assert.equal(companyFacts.ratingSum, 8); assert.equal(companyFacts.ratingCount, 2);
    // Trusted test-only simulation of a future reviewed hide migration; no runtime hide path.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`ALTER TABLE "Review" DISABLE TRIGGER "Review_immutable_history"`;
      await tx.review.update({ where: { id: personalWorker.id }, data: { hiddenAt: new Date() } });
      await tx.$executeRaw`ALTER TABLE "Review" ENABLE TRIGGER "Review_immutable_history"`;
    });
    assert.equal((await db.$transaction((tx) => getWorkerReputationFacts(tx, [wp.id]))).get(wp.id)!.ratingCount, 1);
    assert.equal((await getEngagementReviews(db, worker, "WORKER", personal.e.id)).items.length, 1);
    assert.equal((await getEngagementReviews(db, owner, "EMPLOYER", personal.e.id)).canSubmit, false);
    stage = "private bounded list, visibility opt-in, public aggregate and v2 apply";
    await denied(() => workerReviewsForEmployer(db, owner, wp.id, {}), "NOT_FOUND");
    const contextual = await workerReviewsForEmployer(db, owner, wp.id, {}, personal.a.id); assert.equal(contextual.items.length, 1);
    await setDiscoverable(db, worker, wp.id, { discoverable: true });
    assert.equal((await workerReviewsForEmployer(db, owner, wp.id, { limit: 1 })).items.length, 1);
    await denied(() => workerReviewsForEmployer(db, admin, wp.id, {}), "FORBIDDEN");
    await denied(() => workerReviewsForEmployer(db, owner, wp.id, { limit: 31 }), "VALIDATION");
    const target = await job(company.id);
    const visible = await ownerReviewsForJob(db, worker, target.id, { limit: 1 }); assert.equal(visible.items.length, 1); assert.ok(visible.nextCursor);
    const older = await ownerReviewsForJob(db, worker, target.id, { limit: 1, cursor: visible.nextCursor! }); assert.equal(older.items.length, 1); assert.notEqual(older.items[0].id, visible.items[0].id);
    await denied(() => ownerReviewsForJob(db, worker, target.id, { cursor: p.id }), "VALIDATION");
    const publicFacts = await ownerReputationForPublicJob(db, target.id); assert.equal(publicFacts.rating.average, 4); assert.equal(publicFacts.rating.count, 2); assert.equal("items" in publicFacts, false);
    const application = await applyToJob(db, worker, target.id, { creationKey: randomUUID() });
    assert.equal(application.matchAtApply!.algorithmVersion, "deterministic-v2"); assert.equal(application.matchAtApply!.coverage, 80);
    // Representative historical v1 snapshot inserted as migration-era evidence,
    // never backfilled or overwritten by v2 services.
    const legacyWorker = await actor(["WORKER"]), legacyWp = await db.workerProfile.findUniqueOrThrow({ where: { userId: legacyWorker.id } });
    const legacy = await db.application.create({ data: { jobId: target.id, workerProfileId: legacyWp.id, creationKey: randomUUID(), matchEligibleAtApply: true, matchScoreAtApply: 100, matchCoverageAtApply: 70, matchWeightsVersion: "v1", matchAlgorithmVersion: "deterministic-v1", matchedAt: new Date() } });
    await assert.rejects(() => db.application.update({ where: { id: legacy.id }, data: { matchAlgorithmVersion: "deterministic-v2" } }));
    await actOnApplication(db, owner, legacy.id, "view", {});
    assert.equal((await db.application.findUniqueOrThrow({ where: { id: legacy.id } })).matchAlgorithmVersion, "deterministic-v1");
    stage = "batch query count and actual recommendation v2 ranking";
    const start = queryCount; await db.$transaction((tx) => getWorkerReputationFacts(tx, [wp.id])); const singleQueries = queryCount - start;
    const bulk = Array.from({ length: 199 }, () => ({ id: randomUUID(), userId: randomUUID() })); users.push(...bulk.map((r) => r.userId));
    await db.user.createMany({ data: bulk.map((r) => ({ id: r.userId, name: "Batch worker", email: `${r.userId}@example.invalid`, emailVerified: true })) });
    await db.workerProfile.createMany({ data: bulk.map((r) => ({ id: r.id, userId: r.userId, headline: "Batch" })) });
    const largeStart = queryCount; await db.$transaction((tx) => getWorkerReputationFacts(tx, [wp.id, ...bulk.map((r) => r.id)])); const batchQueries = queryCount - largeStart;
    assert.equal(batchQueries, singleQueries); console.info(`PASS: reputation query count ${batchQueries} for 200 versus ${singleQueries} for one (transaction overhead included).`);
    await setDiscoverable(db, legacyWorker, legacyWp.id, { discoverable: true });
    const candidates = await recommendedCandidates(db, owner, target.id, {});
    const experienced = candidates.items.find((row) => row.id === wp.id)!;
    // No-data remains uncovered, never a fabricated zero rating; the measured
    // Worker-cancellation ratio changes actual current ranking in V2.
    assert.equal(candidates.items[0].id, legacyWp.id); assert.equal(candidates.items[0].match.score, 100);
    assert.equal(experienced.match.score, 98); assert.equal(experienced.match.algorithmVersion, "deterministic-v2"); assert.equal(experienced.match.coverage, 80); assert.equal(experienced.reputation.rating.count, 1);
    stage = "observed membership revocation and account suspension lock races";
    const pending = await work(company.id);
    let held!: () => void, release!: () => void; const heldPromise = new Promise<void>((r) => { held = r; }), releasePromise = new Promise<void>((r) => { release = r; });
    const holder = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`; held(); await releasePromise; await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: manager.id } } }); }, { timeout: 15000 });
    await heldPromise;
    const waiting = submitReview(db, manager, "EMPLOYER", pending.e.id, body()); const assertion = denied(() => waiting, "NOT_FOUND");
    try { await waitLock(); } finally { release(); } await holder; await assertion;
    await denied(() => submitReview(db, manager, "EMPLOYER", pending.e.id, body()), "NOT_FOUND");
    let userHeld!: () => void, userRelease!: () => void; const uh = new Promise<void>((r) => { userHeld = r; }), ur = new Promise<void>((r) => { userRelease = r; });
    const userHolder = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${worker.id} FOR UPDATE`; userHeld(); await ur; await tx.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } }); }, { timeout: 15000 });
    await uh; const awaiting = submitReview(db, worker, "WORKER", pending.e.id, body()); const suspended = denied(() => awaiting, "FORBIDDEN");
    try { await waitLock(); } finally { userRelease(); } await userHolder; await suspended;
    await db.user.update({ where: { id: worker.id }, data: { status: "ACTIVE" } });
    // Trusted ownership replacement proves Company history stays with the entity.
    await db.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`; await tx.companyMember.deleteMany({ where: { companyId: company.id } }); await tx.companyMember.create({ data: { companyId: company.id, userId: other.id, role: "OWNER" } }); });
    await denied(() => submitReview(db, owner, "EMPLOYER", pending.e.id, body()), "NOT_FOUND");
    await submitReview(db, other, "EMPLOYER", pending.e.id, body(4));
    assert.equal((await ownerReputationForPublicJob(db, target.id)).rating.count, 2);
    assert.deepEqual((await db.application.findUniqueOrThrow({ where: { id: application.id } })).matchScoreAtApply, application.matchAtApply!.score);
    const indexes = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_indexes WHERE tablename='Review'`; assert.ok(indexes[0].n >= 6n);
    console.info("PASS: completed bilateral reviews, current Company authority, retry/races, immutable content/targets, hidden exclusion, privacy/cursors, exact aggregates/history, batched v2 matching and frozen historical snapshots.");
  } catch (error) {
    if (error instanceof AppError) console.error(`Policy failure code: ${error.code}`);
    console.error(`FAIL: reviews PostgreSQL at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const ids = (await db.job.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((j) => j.id);
      await db.review.deleteMany({ where: { reviewerUserId: { in: users } } }); await db.userBlock.deleteMany({ where: { blockerUserId: { in: users } } });
      await db.engagement.deleteMany({ where: { jobId: { in: ids } } }); await db.offer.deleteMany({ where: { jobId: { in: ids } } }); await db.application.deleteMany({ where: { jobId: { in: ids } } });
      await db.jobSkill.deleteMany({ where: { jobId: { in: ids } } }); await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: ids } } }); await db.job.deleteMany({ where: { id: { in: ids } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } }); await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } }); await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.rateLimit.deleteMany({ where: { key: { in: users.map((id) => `job-draft:user:${id}`) } } }); await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: reviews fixture cleanup; diagnostics suppressed."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
