import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { AppError } from "../src/shared/errors/app-error";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import type { Principal, Role } from "../src/modules/auth/policy";
import { discoverWorkers, getEmployer, getWorker, saveEmployer, saveWorker, setDiscoverable } from "../src/modules/profiles/service";
import { createCompany, getCompany, listMembers, removeManager, updateCompany } from "../src/modules/companies/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: Phase 3 integration needs TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable.");
  process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const tag = `phase3-${randomUUID()}`;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 10, application_name: tag }) });
  const users: string[] = [];
  const city = `thử nghiệm ${randomBytes(6).toString("hex").replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)))}`;
  let stage = "fixtures";
  async function actor(roles: Role[]): Promise<Principal> {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Integration identity", email: `${id}@example.invalid`, emailVerified: true,
      roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    return { id, name: "Integration identity", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
  }
  async function denied(action: () => Promise<unknown>, code: string) {
    await assert.rejects(action, (error: unknown) => error instanceof AppError && error.code === code);
  }
  async function waitForBlockedMutation() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event_type = 'Lock'`;
      if (Number(rows[0].count)) return;
      await delay(20);
    }
    throw new Error("Mutation did not wait on actual PostgreSQL lock");
  }
  try {
    const worker = await actor(["WORKER", "EMPLOYER"]);
    const secondWorker = await actor(["WORKER"]);
    const employer = await actor(["EMPLOYER"]);
    const manager = await actor(["EMPLOYER"]);
    const outsider = await actor(["EMPLOYER"]);
    const noProfile = await actor(["EMPLOYER"]);
    const admin = await actor(["ADMIN"]);
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "excel" } });
    const workerData = { headline: "Hỗ trợ Excel", city, bio: "Private worker summary", timezone: "Asia/Ho_Chi_Minh",
      preferences: ["PART_TIME"], workModes: ["ON_SITE", "REMOTE"], skills: [{ skillId: skill.id, level: "ADVANCED" }], availability: [] };
    const employerData = { type: "INDIVIDUAL", description: "Personal employer", city };
    assert.equal(await getWorker(db, worker), null);
    assert.equal(await getEmployer(db, employer), null);
    stage = "duplicate worker creation and completeness";
    const duplicates = await Promise.allSettled([saveWorker(db, worker, workerData), saveWorker(db, worker, workerData)]);
    assert.equal(duplicates.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(duplicates.filter((item) => item.status === "rejected" && item.reason instanceof AppError && item.reason.code === "CONFLICT").length, 1);
    let own = (await getWorker(db, worker))!;
    assert.equal(own.discoverable, false);
    assert.equal(own.completeness.complete, false);
    const readyWorkerData = { ...workerData, availability: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    own = await saveWorker(db, worker, readyWorkerData, own.id);
    assert.equal(own.completeness.complete, true);
    assert.equal(own.completeness.percentage, 100);
    const other = await saveWorker(db, secondWorker, readyWorkerData);
    await denied(() => saveWorker(db, secondWorker, readyWorkerData, own.id), "NOT_FOUND");
    await denied(() => setDiscoverable(db, secondWorker, own.id, { discoverable: true }), "NOT_FOUND");
    await denied(() => saveWorker(db, employer, readyWorkerData), "FORBIDDEN");
    await denied(() => saveWorker(db, worker, { ...workerData, userId: secondWorker.id }, own.id), "VALIDATION");
    await assert.rejects(() => db.workerSkill.create({ data: { workerProfileId: own.id, skillId: skill.id, level: "BEGINNER" } }));
    await assert.rejects(() => db.workerAvailability.create({ data: { workerProfileId: own.id, weekday: 7, startHour: 9, endHour: 17 } }));
    stage = "duplicate employer creation and own scope";
    const employerDuplicates = await Promise.allSettled([saveEmployer(db, employer, employerData), saveEmployer(db, employer, employerData)]);
    assert.equal(employerDuplicates.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(employerDuplicates.filter((item) => item.status === "rejected" && item.reason instanceof AppError && item.reason.code === "CONFLICT").length, 1);
    const ownEmployer = (await getEmployer(db, employer))!;
    await saveEmployer(db, employer, { ...employerData, description: "Updated" }, ownEmployer.id);
    await saveEmployer(db, worker, employerData);
    await saveEmployer(db, manager, employerData);
    await saveEmployer(db, outsider, employerData);
    await denied(() => saveEmployer(db, outsider, employerData, ownEmployer.id), "NOT_FOUND");
    assert.ok(await getWorker(db, worker)); assert.ok(await getEmployer(db, worker));
    stage = "discovery opt-in and privacy";
    assert.equal((await discoverWorkers(db, employer, { city })).items.length, 0);
    await setDiscoverable(db, worker, own.id, { discoverable: true });
    const discovered = await discoverWorkers(db, employer, { city, skillId: skill.id, preference: "PART_TIME" });
    assert.equal(discovered.items.length, 1);
    assert.equal(discovered.items[0].id, own.id);
    assert.equal(discovered.items[0].availability, "AVAILABILITY_PROVIDED");
    assert.deepEqual(Object.keys(discovered.items[0]).sort(), ["availability", "city", "displayName", "headline", "id", "preferences", "skills", "workModes"]);
    assert.ok(!JSON.stringify(discovered).includes(worker.email));
    assert.ok(!JSON.stringify(discovered).includes(worker.id));
    await denied(() => discoverWorkers(db, secondWorker, {}), "FORBIDDEN");
    await denied(() => discoverWorkers(db, noProfile, {}), "FORBIDDEN");
    await denied(() => discoverWorkers(db, admin, {}), "FORBIDDEN");
    await denied(() => discoverWorkers(db, employer, { limit: 500 }), "VALIDATION");
    await setDiscoverable(db, secondWorker, other.id, { discoverable: true });
    const firstPage = await discoverWorkers(db, employer, { city, limit: 1 });
    assert.equal(firstPage.items.length, 1); assert.ok(firstPage.nextCursor);
    const secondPage = await discoverWorkers(db, employer, { city, limit: 1, cursor: firstPage.nextCursor });
    assert.equal(secondPage.items.length, 1); assert.notEqual(secondPage.items[0].id, firstPage.items[0].id); assert.equal(secondPage.nextCursor, null);
    await setDiscoverable(db, worker, own.id, { discoverable: false });
    assert.equal((await discoverWorkers(db, employer, { city })).items.length, 1);
    stage = "atomic company owner and retry behavior";
    const companyData = { name: "Công ty kiểm thử", description: "Company foundation", city, website: null };
    const creationKey = randomUUID();
    const [company, retried] = await Promise.all([createCompany(db, employer, { ...companyData, creationKey }), createCompany(db, employer, { ...companyData, creationKey })]);
    assert.equal(company.id, retried.id); assert.equal(company.verification, "UNVERIFIED");
    assert.equal(await db.company.count({ where: { createdByUserId: employer.id } }), 1);
    assert.equal(await db.companyMember.count({ where: { companyId: company.id, role: "OWNER" } }), 1);
    await denied(() => createCompany(db, employer, { ...companyData, name: "Changed retry", creationKey }), "CONFLICT");
    await denied(() => createCompany(db, employer, { ...companyData, creationKey: randomUUID(), verification: "VERIFIED" }), "VALIDATION");
    await denied(() => createCompany(db, noProfile, { ...companyData, creationKey: randomUUID() }), "FORBIDDEN");
    await denied(() => updateCompany(db, outsider, company.id, companyData), "NOT_FOUND");
    // Trusted fixture provisioning only; no public invitation/member-add endpoint.
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    await assert.rejects(() => db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } }));
    await assert.rejects(() => db.companyMember.create({ data: { companyId: company.id, userId: outsider.id, role: "OWNER" } }));
    assert.equal((await updateCompany(db, manager, company.id, companyData)).role, "MANAGER");
    await denied(() => listMembers(db, manager, company.id, {}), "FORBIDDEN");
    await denied(() => removeManager(db, manager, company.id, employer.id), "FORBIDDEN");
    await denied(() => updateCompany(db, manager, company.id, { ...companyData, members: [{ userId: manager.id, role: "OWNER" }] }), "VALIDATION");
    await denied(() => removeManager(db, employer, company.id, employer.id), "CONFLICT");
    assert.equal((await listMembers(db, employer, company.id, {})).items.length, 2);
    await removeManager(db, employer, company.id, manager.id);
    await denied(() => getCompany(db, manager, company.slug), "NOT_FOUND");
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    stage = "in-flight membership revocation on real row locks";
    let pendingRevoked: Promise<string> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`;
      pendingRevoked = updateCompany(db, manager, company.id, { ...companyData, name: "Must not commit" }).then(() => "COMMITTED", (error: unknown) => error instanceof AppError ? error.code : "OTHER");
      await waitForBlockedMutation();
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: manager.id } } });
    }, { timeout: 10_000 });
    assert.equal(await pendingRevoked, "NOT_FOUND");
    assert.equal((await db.company.findUniqueOrThrow({ where: { id: company.id } })).name, companyData.name);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    stage = "in-flight suspension on real user row locks";
    let pendingSuspended: Promise<string> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${manager.id} FOR UPDATE`;
      pendingSuspended = updateCompany(db, manager, company.id, companyData).then(() => "COMMITTED", (error: unknown) => error instanceof AppError ? error.code : "OTHER");
      await waitForBlockedMutation();
      await tx.user.update({ where: { id: manager.id }, data: { status: "SUSPENDED" } });
    }, { timeout: 10_000 });
    assert.equal(await pendingSuspended, "FORBIDDEN");
    await denied(() => createCompany(db, manager, { ...companyData, creationKey: randomUUID() }), "FORBIDDEN");
    await db.user.update({ where: { id: worker.id }, data: { status: "SUSPENDED" } });
    await denied(() => saveWorker(db, worker, readyWorkerData), "FORBIDDEN");
    await denied(() => saveEmployer(db, worker, employerData), "FORBIDDEN");
    await denied(() => saveWorker(db, worker, readyWorkerData, own.id), "FORBIDDEN");
    const dualEmployerId = (await getEmployer(db, worker))!.id;
    await denied(() => saveEmployer(db, worker, employerData, dualEmployerId), "FORBIDDEN");
    await denied(() => setDiscoverable(db, worker, own.id, { discoverable: true }), "FORBIDDEN");
    await setDiscoverable(db, worker, own.id, { discoverable: false });
    await db.user.update({ where: { id: worker.id }, data: { status: "BANNED" } });
    await denied(() => saveWorker(db, worker, readyWorkerData, own.id), "FORBIDDEN");
    await denied(() => setDiscoverable(db, worker, own.id, { discoverable: true }), "FORBIDDEN");
    await setDiscoverable(db, worker, own.id, { discoverable: false });
    stage = "creator departure does not retain company access";
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`;
      await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: employer.id } } });
      await tx.companyMember.update({ where: { companyId_userId: { companyId: company.id, userId: manager.id } }, data: { role: "OWNER" } });
    });
    await denied(() => getCompany(db, employer, company.slug), "NOT_FOUND");
    await denied(() => createCompany(db, employer, { ...companyData, creationKey }), "NOT_FOUND");
    assert.equal(await db.company.count({ where: { id: company.id } }), 1);
    console.info("PASS: Phase 3 PostgreSQL profiles/completeness/privacy/pagination, company atomicity/uniqueness/owner protection, real revocation/suspension races and creator departure.");
  } catch {
    console.error(`FAIL: Phase 3 PostgreSQL integration at ${stage}; sensitive details suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const companyIds = (await db.company.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((item) => item.id);
      await db.companyMember.deleteMany({ where: { companyId: { in: companyIds } } });
      await db.company.deleteMany({ where: { id: { in: companyIds } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: Phase 3 fixture cleanup; details suppressed."); process.exitCode = 1; }
    try { await db.$disconnect(); } catch { console.error("FAIL: Phase 3 disconnect; details suppressed."); process.exitCode = 1; }
  }
}
