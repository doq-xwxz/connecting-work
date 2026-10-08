import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import type { Principal, Role } from "../src/modules/auth/policy";
import { AppError } from "../src/shared/errors/app-error";
import { saveEmployer, saveWorker, setDiscoverable } from "../src/modules/profiles/service";
import { createCompany, removeManager } from "../src/modules/companies/service";
import { createJob, editJob, getManagedJob, listPublicJobs, transitionJob } from "../src/modules/jobs/service";
import type { JobInput } from "../src/modules/jobs/contracts";
import { recommendedCandidates, recommendedJobs } from "../src/modules/matching/service";
import { isRelevantMatch } from "../src/modules/matching/algorithm";
import { applyToJob, getApplication, actOnApplication } from "../src/modules/hiring/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: matching requires TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 5 }), log: [{ level: "query", emit: "event" }] });
  let queryCount = 0;
  // Count only; never log SQL, parameters, query text or profile data.
  db.$on("query", () => { queryCount++; });
  const users: string[] = [], companies: string[] = [];
  let stage = "fixtures";
  const skill = await db.skill.findUniqueOrThrow({ where: { slug: "excel" } });
  const otherSkill = await db.skill.findFirstOrThrow({ where: { id: { not: skill.id }, active: true } });
  const workerInput = { headline: "Matching specialist", city: "hà nội", bio: "Private", timezone: "Asia/Ho_Chi_Minh", preferences: ["FULL_TIME"], workModes: ["REMOTE", "ON_SITE"],
    skills: [{ skillId: skill.id, level: "INTERMEDIATE" }], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] };
  const jobInput: JobInput = { title: "Đối chiếu dữ liệu", description: "Bảng tính chuyên nghiệp", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: "hà nội",
    compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2, startDate: null, endDate: null,
    timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId: skill.id, required: true, minimumLevel: "INTERMEDIATE" }], schedule: workerInput.availability };
  async function actor(roles: Role[] = ["WORKER"], employerProfile = true) {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Matching identity", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const principal: Principal = { id, name: "Matching identity", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER") && employerProfile) await saveEmployer(db, principal, { type: "INDIVIDUAL", city: null, description: "" });
    if (roles.includes("WORKER")) await saveWorker(db, principal, workerInput);
    return principal;
  }
  async function denied(action: () => Promise<unknown>, code: string) {
    await assert.rejects(action, (error: unknown) => error instanceof AppError && error.code === code);
  }
  try {
    const owner = await actor(["WORKER", "EMPLOYER"]), worker = await actor(), other = await actor(["EMPLOYER"]), noProfile = await actor(["EMPLOYER"], false), admin = await actor(["ADMIN"]);
    const company = await createCompany(db, owner, { name: "Matching company", description: "", city: null, website: null, creationKey: randomUUID() }); companies.push(company.id);
    const manager = await actor(["WORKER", "EMPLOYER"]);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    const create = (input: Partial<JobInput> = {}) => createJob(db, owner, { ...jobInput, ...input, companyId: company.id, creationKey: randomUUID() });
    const move = async (id: string, action: "publish" | "pause" | "close" | "cancel") => {
      const job = await getManagedJob(db, owner, id); return transitionJob(db, owner, id, action, { expectedVersion: job.version });
    };
    let first = await move((await create()).id, "publish");
    const second = await move((await create({ title: "Bảng tính", description: "Đối chiếu dữ liệu" })).id, "publish");
    const draft = await create({ title: "Đối chiếu dữ liệu riêng" });
    stage = "FTS weighted Unicode tokens, visibility, filters, index and cursor";
    const found = await listPublicJobs(db, { q: "đối chiếu dữ liệu", skillId: skill.id, limit: 1 });
    stage = "FTS first weighted Unicode title result";
    assert.equal(found.items[0].id, first.id); assert.ok(found.nextCursor);
    const next = await listPublicJobs(db, { q: "đối chiếu dữ liệu", skillId: skill.id, limit: 1, cursor: found.nextCursor });
    stage = "FTS second keyset page";
    assert.equal(next.items[0].id, second.id); assert.equal(next.nextCursor, null);
    stage = "FTS composable filters";
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", category: "CREATIVE" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", workMode: "ON_SITE" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", city: "đà nẵng" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", employmentType: "SHIFT" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", skillId: otherSkill.id })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", compensationType: "HOURLY", compensationMin: "90000" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", compensationType: "HOURLY", compensationMin: "80000", compensationMax: "90000" })).items.length, 2);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu", compensationType: "MONTHLY", compensationMin: "1" })).items.length, 0);
    stage = "FTS invalid query and cursor safety";
    for (const raw of [{ q: "a:*" }, { q: "' OR 1=1 --" }, { q: "x".repeat(201) }, { cursor: "garbage" }, { q: "different", cursor: found.nextCursor }, { limit: 31 }, { score: 100 }, { status: "DRAFT" }]) await denied(() => listPublicJobs(db, raw), "VALIDATION");
    stage = "FTS GIN index and query plan";
    const [index] = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname='Job_published_search_gin'`;
    assert.match(index.indexdef, /USING gin/); assert.match(index.indexdef, /PUBLISHED/);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      const plan = await tx.$queryRaw`EXPLAIN (FORMAT JSON) SELECT "id" FROM "Job" WHERE "status"='PUBLISHED' AND "searchVector" @@ plainto_tsquery('simple', 'đối chiếu')`;
      // A tiny fixture may legitimately favor the status btree over GIN. Check
      // index-capable planning separately from the exact catalog GIN definition.
      assert.match(JSON.stringify(plan), /Index|Bitmap/);
    });
    stage = "FTS updates and state visibility";
    first = await editJob(db, owner, first.id, { ...jobInput, title: "Báo cáo mới", description: "Tổng hợp báo cáo", expectedVersion: first.version });
    assert.equal((await listPublicJobs(db, { q: "báo cáo" })).items[0].id, first.id);
    assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu" })).items.some((job) => job.id === first.id), false);
    await move(second.id, "pause"); assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu" })).items.length, 0);
    await move(second.id, "close"); assert.equal((await listPublicJobs(db, { q: "đối chiếu dữ liệu" })).items.length, 0);
    assert.equal((await listPublicJobs(db, { q: "riêng" })).items.length, 0);
    stage = "recommendation authorization, opt-in, score, coverage and privacy";
    const own = await db.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    await setDiscoverable(db, worker, own.id, { discoverable: true });
    const singleStart = queryCount;
    const candidates = await recommendedCandidates(db, manager, first.id, {});
    const singleCandidateQueries = queryCount - singleStart;
    assert.equal(candidates.items.length, 1); assert.equal(candidates.items[0].id, own.id);
    assert.deepEqual({ score: candidates.items[0].match.score, coverage: candidates.items[0].match.coverage }, { score: 100, coverage: 70 });
    assert.equal(isRelevantMatch(candidates.items[0].match), true);
    const payload = JSON.stringify(candidates);
    for (const secret of [worker.email, worker.id, "Private", "startHour", "endHour", "timezone", "userId", "emailVerified"]) assert.equal(payload.includes(secret), false);
    assert.equal((await recommendedJobs(db, owner, {})).items.some((job) => job.id === first.id), false);
    assert.equal((await recommendedJobs(db, manager, {})).items.some((job) => job.id === first.id), false);
    assert.equal((await recommendedJobs(db, worker, {})).items.some((job) => job.id === first.id), true);
    await denied(() => recommendedCandidates(db, other, first.id, {}), "NOT_FOUND");
    await denied(() => recommendedCandidates(db, worker, first.id, {}), "FORBIDDEN");
    await denied(() => recommendedCandidates(db, noProfile, first.id, {}), "FORBIDDEN");
    await denied(() => recommendedCandidates(db, admin, first.id, {}), "FORBIDDEN");
    await denied(() => recommendedCandidates(db, owner, draft.id, {}), "CONFLICT");
    for (const raw of [{ limit: 31 }, { workerId: own.id }, { score: 100 }, { cursor: "garbage" }]) await denied(() => recommendedCandidates(db, owner, first.id, raw), "VALIDATION");
    await db.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } });
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    await denied(() => recommendedJobs(db, worker, {}), "FORBIDDEN");
    await db.user.update({ where: { id: worker.id }, data: { status: "BANNED" } });
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    await db.user.update({ where: { id: worker.id }, data: { status: "ACTIVE" } });
    await saveWorker(db, worker, { ...workerInput, skills: [{ skillId: otherSkill.id, level: "EXPERT" }] }, own.id);
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    await saveWorker(db, worker, { ...workerInput, skills: [{ skillId: skill.id, level: "BEGINNER" }] }, own.id);
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    await saveWorker(db, worker, { ...workerInput, availability: [] }, own.id);
    const missing = (await recommendedCandidates(db, owner, first.id, {})).items[0].match;
    assert.equal(missing.score, 100); assert.equal(missing.coverage, 50); assert.equal(isRelevantMatch(missing), false);
    await saveWorker(db, worker, { ...workerInput, availability: [{ weekday: 1, startHour: 9, endHour: 12 }] }, own.id);
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items[0].match.score, 82);
    await saveWorker(db, worker, workerInput, own.id);
    stage = "immutable new-application snapshot and historical null";
    const app = await applyToJob(db, worker, first.id, { creationKey: randomUUID() });
    assert.equal(app.matchAtApply?.score, 100); assert.equal(app.matchAtApply?.coverage, 70);
    assert.equal((await recommendedJobs(db, worker, {})).items.some((job) => job.id === first.id), false);
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 1);
    await setDiscoverable(db, worker, own.id, { discoverable: false });
    assert.equal((await recommendedCandidates(db, owner, first.id, {})).items.length, 0);
    assert.ok((await getApplication(db, owner, "EMPLOYER", app.id)).worker);
    await saveWorker(db, worker, { ...workerInput, availability: [] }, own.id);
    first = await editJob(db, owner, first.id, { ...jobInput, title: first.title, description: "Changed description", expectedVersion: first.version });
    await move(first.id, "close"); await actOnApplication(db, owner, app.id, "shortlist", {});
    assert.deepEqual((await getApplication(db, worker, "WORKER", app.id)).matchAtApply, app.matchAtApply);
    await assert.rejects(() => db.application.update({ where: { id: app.id }, data: { matchScoreAtApply: 0 } }));
    const legacy = await db.application.create({ data: { jobId: draft.id, workerProfileId: own.id, creationKey: randomUUID() } });
    assert.equal((await getApplication(db, worker, "WORKER", legacy.id)).matchAtApply, null);
    await assert.rejects(() => db.application.update({ where: { id: legacy.id }, data: { matchEligibleAtApply: true, matchScoreAtApply: 100, matchCoverageAtApply: 70, matchWeightsVersion: "v1", matchAlgorithmVersion: "deterministic-v1", matchedAt: new Date() } }));
    stage = "departed current company management and optional skill";
    await removeManager(db, owner, company.id, manager.id);
    await denied(() => recommendedCandidates(db, manager, draft.id, {}), "NOT_FOUND");
    const optional = await move((await create({ skills: [{ skillId: otherSkill.id, required: false, minimumLevel: "EXPERT" }] })).id, "publish");
    await setDiscoverable(db, worker, own.id, { discoverable: true });
    const optionalMatch = (await recommendedCandidates(db, owner, optional.id, {})).items[0].match;
    assert.equal(optionalMatch.eligible, true); assert.equal(optionalMatch.components.find((c) => c.key === "skills")?.score, 0);
    assert.equal((await recommendedJobs(db, manager, {})).items.some((job) => job.id === optional.id), true);
    stage = "coarse location, missing schedule, bounded ranking and cursor scope";
    const locationJob = await editJob(db, owner, optional.id, { ...jobInput, skills: [{ skillId: otherSkill.id, required: false, minimumLevel: "EXPERT" }], workMode: "ON_SITE", city: "đà nẵng", expectedVersion: optional.version });
    const locationMismatch = (await recommendedCandidates(db, owner, optional.id, {})).items[0].match;
    assert.equal(locationMismatch.eligible, true); assert.equal(locationMismatch.components.find((c) => c.key === "location")?.score, 0);
    await editJob(db, owner, optional.id, { ...jobInput, skills: [{ skillId: otherSkill.id, required: false, minimumLevel: "EXPERT" }], schedule: [], expectedVersion: locationJob.version });
    const twin = await actor(); const twinProfile = await db.workerProfile.findUniqueOrThrow({ where: { userId: twin.id } });
    await setDiscoverable(db, twin, twinProfile.id, { discoverable: true });
    const ranked = await recommendedCandidates(db, owner, optional.id, { limit: 1 }); assert.ok(ranked.nextCursor);
    const rankedNext = await recommendedCandidates(db, owner, optional.id, { limit: 1, cursor: ranked.nextCursor });
    assert.notEqual(ranked.items[0].id, rankedNext.items[0].id); assert.equal(rankedNext.nextCursor, null); assert.equal(ranked.candidatePoolLimit, 200);
    await denied(() => recommendedJobs(db, worker, { cursor: ranked.nextCursor }), "VALIDATION");
    await denied(() => recommendedCandidates(db, manager, optional.id, { cursor: ranked.nextCursor }), "NOT_FOUND");
    stage = "creator departure removes candidate management authority";
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id"=${company.id} FOR UPDATE`;
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: owner.id } } });
      await tx.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "OWNER" } });
    });
    await denied(() => recommendedCandidates(db, owner, optional.id, {}), "NOT_FOUND");
    assert.equal((await recommendedCandidates(db, manager, optional.id, {})).items.length, 2);
    stage = "real 203-candidate pool cap, page cap and query-count scaling";
    const bulk = Array.from({ length: 201 }, () => ({ userId: randomUUID(), profileId: randomUUID() }));
    users.push(...bulk.map((item) => item.userId));
    await db.user.createMany({ data: bulk.map((item) => ({ id: item.userId, name: "Bounded fixture", email: `${item.userId}@example.invalid`, emailVerified: true })) });
    await db.userRole.createMany({ data: bulk.map((item) => ({ userId: item.userId, role: "WORKER", grantedBy: "test-fixture" })) });
    await db.workerProfile.createMany({ data: bulk.map((item) => ({ id: item.profileId, userId: item.userId, headline: "Bounded fixture", city: "hà nội", discoverable: true })) });
    await db.workerSkill.createMany({ data: bulk.map((item) => ({ workerProfileId: item.profileId, skillId: skill.id, level: "INTERMEDIATE" })) });
    await db.workerPreference.createMany({ data: bulk.map((item) => ({ workerProfileId: item.profileId, type: "FULL_TIME" })) });
    await db.workerWorkMode.createMany({ data: bulk.map((item) => ({ workerProfileId: item.profileId, mode: "REMOTE" })) });
    const poolStart = queryCount;
    let boundedPage = await recommendedCandidates(db, manager, optional.id, { limit: 30 });
    const poolQueries = queryCount - poolStart;
    assert.ok(poolQueries <= singleCandidateQueries + 8, "Relation query count must remain constant with candidate count");
    assert.equal(boundedPage.items.length, 30);
    const returned = new Set(boundedPage.items.map((item) => item.id));
    while (boundedPage.nextCursor) {
      boundedPage = await recommendedCandidates(db, manager, optional.id, { limit: 30, cursor: boundedPage.nextCursor });
      assert.ok(boundedPage.items.length <= 30);
      for (const item of boundedPage.items) { assert.equal(returned.has(item.id), false); returned.add(item.id); }
    }
    assert.equal(returned.size, 200);
    console.info(`PASS: 203 eligible candidates bounded to 200, page cap 30; observed batched query count ${poolQueries} versus ${singleCandidateQueries} for one candidate.`);
    console.info("PASS: PostgreSQL FTS/index/update/Unicode/filter/cursor/injection, bounded private recommendations/current roles/membership/opt-in, scoring/coverage and immutable apply snapshots; owned fixtures cleaned.");
  } catch (error) {
    if (error instanceof AppError) console.error(`Policy failure code: ${error.code}`);
    console.error(`FAIL: matching PostgreSQL verification at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const ids = (await db.job.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((job) => job.id);
      await db.engagement.deleteMany({ where: { jobId: { in: ids } } }); await db.offer.deleteMany({ where: { jobId: { in: ids } } }); await db.application.deleteMany({ where: { jobId: { in: ids } } });
      await db.jobSkill.deleteMany({ where: { jobId: { in: ids } } }); await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: ids } } }); await db.job.deleteMany({ where: { id: { in: ids } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } }); await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } }); await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: matching fixture cleanup; diagnostics suppressed."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
