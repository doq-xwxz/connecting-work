import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import { AppError } from "../src/shared/errors/app-error";
import type { Principal, Role } from "../src/modules/auth/policy";
import { saveEmployer } from "../src/modules/profiles/service";
import { createCompany, removeManager } from "../src/modules/companies/service";
import { createJob, duplicateJob, editJob, getManagedJob, getPublicJob, listManagedJobs, listPublicJobs, transitionJob } from "../src/modules/jobs/service";
import type { JobInput, ManagedJob } from "../src/modules/jobs/contracts";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: jobs integration needs TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const tag = `phase4-${randomUUID()}`;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12, application_name: tag }) });
  const users: string[] = [], companies: string[] = [], testSkills: string[] = [];
  const city = `kiểm thử ${randomBytes(6).toString("hex").replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)))}`;
  let stage = "fixtures";
  async function actor(roles: Role[] = ["EMPLOYER"], verified = true): Promise<Principal> {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Job test identity", email: `${id}@example.invalid`, emailVerified: verified,
      roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const user: Principal = { id, name: "Job test identity", email: `${id}@example.invalid`, emailVerified: verified, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER")) await saveEmployer(db, user, { type: "INDIVIDUAL", description: "", city });
    return user;
  }
  async function company(actor: Principal) {
    const result = await createCompany(db, actor, { name: "Job test company", description: "", city, website: null, creationKey: randomUUID() });
    companies.push(result.id); return result;
  }
  async function denied(action: () => Promise<unknown>, code: string) { await assert.rejects(action, (error: unknown) => error instanceof AppError && error.code === code); }
  async function move(actor: Principal, job: ManagedJob, action: "publish" | "pause" | "resume" | "close" | "cancel") {
    return transitionJob(db, actor, job.id, action, { expectedVersion: job.version });
  }
  async function waitForLock() {
    for (let attempt = 0; attempt < 150; attempt++) {
      const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event_type = 'Lock'`;
      if (Number(rows[0].count)) return; await delay(20);
    }
    throw new Error("Actual PostgreSQL lock wait not observed");
  }
  try {
    const owner = await actor(), manager = await actor(), other = await actor(), concurrent = await actor(), unverified = await actor(["EMPLOYER"], false), worker = await actor(["WORKER"]), admin = await actor(["ADMIN"]);
    const a = await company(owner), b = await company(owner), c = await company(owner);
    await db.companyMember.createMany({ data: [a, c].map((item) => ({ companyId: item.id, userId: manager.id, role: "MANAGER" })) });
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "excel" } });
    const input: JobInput = { title: "Job integration", description: "Structured job terms", category: "FINANCE_ACCOUNTING", employmentType: "PART_TIME", workMode: "REMOTE", city,
      compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2,
      startDate: "2026-11-01", endDate: "2026-11-30", timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId: skill.id, required: true, minimumLevel: "INTERMEDIATE" }],
      schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    const draft = (actor: Principal, companyId: string | null = null, override: Partial<JobInput> = {}) => createJob(db, actor, { ...input, ...override, companyId, creationKey: randomUUID() });
    stage = "draft completeness, active skills and ownership validation";
    let incomplete = await draft(owner, null, { title: "", skills: [], schedule: [] });
    assert.equal(incomplete.status, "DRAFT"); assert.equal(incomplete.publishValidation.valid, false);
    await denied(() => move(owner, incomplete, "publish"), "VALIDATION");
    incomplete = await editJob(db, owner, incomplete.id, { ...input, expectedVersion: incomplete.version });
    assert.equal(incomplete.publishValidation.valid, true);
    await denied(() => editJob(db, other, incomplete.id, { ...input, expectedVersion: incomplete.version }), "NOT_FOUND");
    await denied(() => draft(worker), "FORBIDDEN"); await denied(() => draft(admin), "FORBIDDEN");
    await denied(() => draft(other, a.id), "NOT_FOUND");
    await denied(() => createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID(), createdByUserId: other.id }), "VALIDATION");
    await denied(() => draft(owner, null, { skills: [{ ...input.skills[0], skillId: randomUUID() }] }), "VALIDATION");
    const inactiveId = randomUUID(); testSkills.push(inactiveId);
    await db.skill.create({ data: { id: inactiveId, slug: `test-${inactiveId}`, name: "Inactive test", category: "TEST", active: false } });
    await denied(() => draft(owner, null, { skills: [{ ...input.skills[0], skillId: inactiveId }] }), "VALIDATION");
    const key = randomUUID();
    const replay1 = await createJob(db, other, { ...input, companyId: null, creationKey: key });
    const replay2 = await createJob(db, other, { ...input, companyId: null, creationKey: key }); assert.equal(replay1.id, replay2.id);
    await denied(() => createJob(db, other, { ...input, title: "Different request", companyId: null, creationKey: key }), "CONFLICT");
    await denied(() => duplicateJob(db, other, replay1.id, { creationKey: key }), "CONFLICT");
    // Existing draft is cancelled so owner scopes start clean for quota exercises.
    incomplete = await move(owner, incomplete, "cancel");
    stage = "independent personal and company quotas, paused/resume and freed slots";
    const scopeJobs = new Map<string, ManagedJob[]>();
    for (const scope of [null, a.id, b.id]) {
      const jobs: ManagedJob[] = [];
      for (let index = 0; index < 5; index++) jobs.push(await draft(scope === a.id && index % 2 ? manager : owner, scope));
      const writer = (index: number) => scope === a.id && index % 2 ? manager : owner;
      for (let index = 0; index < 3; index++) jobs[index] = await move(writer(index), jobs[index], "publish");
      assert.equal(jobs[2].quota.active, 3);
      jobs[0] = await move(writer(0), jobs[0], "pause"); assert.equal(jobs[0].quota.active, 3);
      await denied(() => move(writer(3), jobs[3], "publish"), "CONFLICT");
      assert.equal((await getManagedJob(db, writer(3), jobs[3].id)).status, "DRAFT");
      assert.equal((await getManagedJob(db, writer(3), jobs[3].id)).publishedAt, null);
      jobs[0] = await move(writer(0), jobs[0], "resume"); assert.equal(jobs[0].quota.active, 3);
      jobs[0] = await move(writer(0), jobs[0], "close"); assert.equal(jobs[0].quota.active, 2);
      await denied(() => move(writer(0), jobs[0], "publish"), "CONFLICT");
      jobs[3] = await move(writer(3), jobs[3], "publish");
      jobs[1] = await move(writer(1), jobs[1], "cancel"); assert.equal(jobs[1].quota.active, 2);
      jobs[4] = await move(writer(4), jobs[4], "publish"); assert.equal(jobs[4].quota.active, 3);
      scopeJobs.set(scope ?? "personal", jobs);
    }
    const personal = scopeJobs.get("personal")!;
    assert.equal((await getManagedJob(db, owner, personal[2].id)).quota.active, 3);
    for (const item of [a, b]) assert.equal((await getManagedJob(db, owner, scopeJobs.get(item.id)![2].id)).quota.active, 3);
    stage = "real concurrent publication per personal scope";
    const competingPersonal: ManagedJob[] = [];
    for (let index = 0; index < 4; index++) competingPersonal.push(await draft(concurrent));
    const personalResults = await Promise.allSettled(competingPersonal.map((job) => move(concurrent, job, "publish")));
    assert.equal(personalResults.filter((result) => result.status === "fulfilled").length, 3);
    assert.equal(personalResults.filter((result) => result.status === "rejected" && result.reason instanceof AppError && result.reason.code === "CONFLICT").length, 1);
    stage = "real competing managers serialize on company owner quota";
    const companyRace: ManagedJob[] = [];
    for (let index = 0; index < 4; index++) companyRace.push(await draft(index % 2 ? manager : owner, c.id));
    companyRace[0] = await move(owner, companyRace[0], "publish"); companyRace[1] = await move(manager, companyRace[1], "publish");
    const companyResults = await Promise.allSettled([move(owner, companyRace[2], "publish"), move(manager, companyRace[3], "publish")]);
    assert.equal(companyResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(companyResults.filter((result) => result.status === "rejected" && result.reason instanceof AppError && result.reason.code === "CONFLICT").length, 1);
    assert.equal(await db.job.count({ where: { companyId: c.id, status: { in: ["PUBLISHED", "PAUSED"] } } }), 3);
    companyRace[0] = await move(owner, companyRace[0], "pause");
    const loser = (await getManagedJob(db, owner, companyRace[2].id)).status === "DRAFT" ? companyRace[2] : companyRace[3];
    const resumeResults = await Promise.allSettled([move(manager, companyRace[0], "resume"), move(owner, loser, "publish")]);
    assert.equal(resumeResults[0].status, "fulfilled"); assert.equal(resumeResults[1].status, "rejected");
    stage = "published editing, lifecycle terminal and detached duplication";
    let edited = await editJob(db, owner, personal[2].id, { ...input, title: "Edited before applications", expectedVersion: personal[2].version });
    await denied(() => editJob(db, owner, edited.id, { ...input, expectedVersion: personal[2].version }), "CONFLICT");
    await denied(() => editJob(db, owner, edited.id, { ...input, title: "", expectedVersion: edited.version }), "VALIDATION");
    await denied(() => editJob(db, owner, edited.id, { ...input, status: "COMPLETED", expectedVersion: edited.version }), "VALIDATION");
    const duplicated = await duplicateJob(db, owner, personal[0].id, { creationKey: randomUUID() });
    assert.notEqual(duplicated.id, personal[0].id); assert.equal(duplicated.status, "DRAFT"); assert.equal(duplicated.version, 1);
    assert.equal(duplicated.publishedAt, null); assert.equal(duplicated.closedAt, null); assert.deepEqual(duplicated.skills, input.skills);
    await denied(() => editJob(db, owner, personal[0].id, { ...input, expectedVersion: personal[0].version }), "CONFLICT");
    await denied(() => move(owner, personal[1], "publish"), "CONFLICT");
    stage = "DB headcount/money/date/window/FK/skill constraints";
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { headcount: 0 } }));
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { compensationMin: 90000n, compensationMax: 1n } }));
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { currency: "USD" } }));
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { endDate: new Date("2026-10-01T00:00:00Z") } }));
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { status: "PUBLISHED" } }));
    await assert.rejects(() => db.jobSkill.create({ data: { jobId: duplicated.id, ...input.skills[0] } }));
    await assert.rejects(() => db.jobScheduleWindow.create({ data: { jobId: duplicated.id, weekday: 7, startHour: 9, endHour: 17 } }));
    await assert.rejects(() => db.job.update({ where: { id: duplicated.id }, data: { companyId: randomUUID() } }));
    const completedFixture = await draft(owner);
    await db.job.update({ where: { id: completedFixture.id }, data: { status: "COMPLETED", publishedAt: new Date() } });
    const completed = await getManagedJob(db, owner, completedFixture.id);
    await denied(() => move(owner, completed, "publish"), "CONFLICT");
    await denied(() => move(owner, completed, "cancel"), "CONFLICT");
    await denied(() => editJob(db, owner, completed.id, { ...input, expectedVersion: completed.version }), "CONFLICT");
    await denied(() => getPublicJob(db, completed.id), "NOT_FOUND");
    stage = "public visibility, privacy, pagination and management scope";
    assert.equal((await getPublicJob(db, edited.id)).title, "Edited before applications");
    for (const job of [personal[0], personal[1], duplicated]) await denied(() => getPublicJob(db, job.id), "NOT_FOUND");
    const first = await listPublicJobs(db, { city, limit: 1 }); assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const second = await listPublicJobs(db, { city, limit: 1, cursor: first.nextCursor }); assert.notEqual(first.items[0].id, second.items[0].id);
    assert.ok(!JSON.stringify(first).includes(owner.email)); assert.ok(!JSON.stringify(first).includes(owner.id));
    assert.ok(!JSON.stringify(first).includes((await db.employerProfile.findUniqueOrThrow({ where: { userId: owner.id } })).id));
    await denied(() => listPublicJobs(db, { limit: 1000 }), "VALIDATION");
    const privatePage = await listManagedJobs(db, other, { limit: 30 }); assert.equal(privatePage.items.length, 1); assert.equal(privatePage.items[0].id, replay1.id);
    await denied(() => getManagedJob(db, other, personal[2].id), "NOT_FOUND");
    await denied(() => getManagedJob(db, other, scopeJobs.get(a.id)![2].id), "NOT_FOUND");
    stage = "fresh verification, suspension and risk-reducing actions";
    let unverifiedJob = await draft(unverified); await denied(() => move(unverified, unverifiedJob, "publish"), "FORBIDDEN");
    await db.user.update({ where: { id: unverified.id }, data: { emailVerified: true } });
    unverifiedJob = await move(unverified, unverifiedJob, "publish");
    await db.user.update({ where: { id: unverified.id }, data: { emailVerified: false } });
    unverifiedJob = await move(unverified, unverifiedJob, "pause"); await denied(() => move(unverified, unverifiedJob, "resume"), "FORBIDDEN");
    await db.user.update({ where: { id: owner.id }, data: { status: "SUSPENDED" } });
    await denied(() => draft(owner), "FORBIDDEN"); await denied(() => move(owner, duplicated, "publish"), "FORBIDDEN");
    await denied(() => duplicateJob(db, owner, edited.id, { creationKey: randomUUID() }), "FORBIDDEN");
    edited = await move(owner, edited, "pause"); await denied(() => move(owner, edited, "resume"), "FORBIDDEN");
    edited = await move(owner, edited, "close");
    await db.user.update({ where: { id: owner.id }, data: { status: "BANNED" } });
    await denied(() => draft(owner), "FORBIDDEN"); await move(owner, duplicated, "cancel");
    await db.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
    stage = "membership removal while job write is blocked on Company lock";
    const aJob = scopeJobs.get(a.id)![2]; let revoked: Promise<string> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${a.id} FOR UPDATE`;
      revoked = editJob(db, manager, aJob.id, { ...input, title: "Must not commit", expectedVersion: aJob.version }).then(() => "COMMITTED", (error: unknown) => error instanceof AppError ? error.code : "OTHER");
      await waitForLock(); await tx.companyMember.delete({ where: { companyId_userId: { companyId: a.id, userId: manager.id } } });
    }, { timeout: 15_000 });
    assert.equal(await revoked, "NOT_FOUND"); assert.equal((await getManagedJob(db, owner, aJob.id)).title, input.title);
    await db.companyMember.create({ data: { companyId: a.id, userId: manager.id, role: "MANAGER" } });
    stage = "suspension before sensitive job mutation commits";
    const managerDraft = await draft(manager, a.id); let suspended: Promise<string> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${manager.id} FOR UPDATE`;
      suspended = duplicateJob(db, manager, managerDraft.id, { creationKey: randomUUID() }).then(() => "COMMITTED", (error: unknown) => error instanceof AppError ? error.code : "OTHER");
      await waitForLock(); await tx.user.update({ where: { id: manager.id }, data: { status: "SUSPENDED" } });
    }, { timeout: 15_000 });
    assert.equal(await suspended, "FORBIDDEN"); await db.user.update({ where: { id: manager.id }, data: { status: "ACTIVE" } });
    stage = "company remains owner after creator departure";
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${a.id} FOR UPDATE`;
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: a.id, userId: owner.id } } });
      await tx.companyMember.update({ where: { companyId_userId: { companyId: a.id, userId: manager.id } }, data: { role: "OWNER" } });
    });
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: aJob.id } })).createdByUserId, owner.id);
    await denied(() => getManagedJob(db, owner, aJob.id), "NOT_FOUND");
    await denied(() => editJob(db, owner, aJob.id, { ...input, expectedVersion: aJob.version }), "NOT_FOUND");
    await denied(() => duplicateJob(db, owner, aJob.id, { creationKey: randomUUID() }), "NOT_FOUND");
    const currentOwnerJob = await getManagedJob(db, manager, aJob.id); assert.equal(currentOwnerJob.quota.active, 3);
    const currentOwnerEdit = await editJob(db, manager, aJob.id, { ...input, description: "Company retains ownership", expectedVersion: currentOwnerJob.version });
    assert.equal(currentOwnerEdit.description, "Company retains ownership");
    const copiedCompanyJob = await duplicateJob(db, manager, aJob.id, { creationKey: randomUUID() });
    const copiedRow = await db.job.findUniqueOrThrow({ where: { id: copiedCompanyJob.id } });
    assert.equal(copiedRow.companyId, a.id); assert.equal(copiedRow.createdByUserId, manager.id);
    assert.equal(copiedRow.employerProfileId, (await db.employerProfile.findUniqueOrThrow({ where: { userId: manager.id } })).id);
    assert.equal(copiedCompanyJob.status, "DRAFT"); assert.equal(copiedCompanyJob.quota.active, 3);
    await denied(() => removeManager(db, owner, a.id, manager.id), "NOT_FOUND");
    console.info("PASS: Phase 4 PostgreSQL Jobs/lifecycle/duplication/privacy/constraints, independent owner quotas, competing publishers/resume, fresh verification/status, real revocation/suspension races and departed-creator isolation.");
  } catch {
    console.error(`FAIL: jobs PostgreSQL integration at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const ids = (await db.job.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((job) => job.id);
      await db.jobSkill.deleteMany({ where: { jobId: { in: ids } } }); await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: ids } } });
      await db.job.deleteMany({ where: { id: { in: ids } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } }); await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.employerProfile.deleteMany({ where: { userId: { in: users } } }); await db.userRole.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } }); await db.skill.deleteMany({ where: { id: { in: testSkills } } });
    } catch { console.error("FAIL: jobs fixture cleanup; details suppressed."); process.exitCode = 1; }
    try { await db.$disconnect(); } catch { process.exitCode = 1; }
  }
}
