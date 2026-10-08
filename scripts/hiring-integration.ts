import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";
import { AppError } from "../src/shared/errors/app-error";
import type { Principal, Role } from "../src/modules/auth/policy";
import { saveEmployer, saveWorker } from "../src/modules/profiles/service";
import { createCompany, removeManager } from "../src/modules/companies/service";
import { createJob, editJob, getManagedJob, transitionJob } from "../src/modules/jobs/service";
import type { JobInput, ManagedJob } from "../src/modules/jobs/contracts";
import { actOnApplication, actOnEngagement, actOnOffer, applyToJob, createOffer, getApplication, listApplications, listOffers } from "../src/modules/hiring/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: hiring integration requires TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const tag = `phase5-${randomUUID()}`;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12, application_name: tag }) });
  const users: string[] = [], companies: string[] = [];
  let stage = "fixtures";
  async function actor(roles: Role[] = ["WORKER"], profile = true) {
    const id = randomUUID(); users.push(id);
    await db.user.create({ data: { id, name: "Hiring test identity", email: `${id}@example.invalid`, emailVerified: true,
      roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
    const principal: Principal = { id, name: "Hiring test identity", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
    if (roles.includes("EMPLOYER")) await saveEmployer(db, principal, { type: "INDIVIDUAL", city: null, description: "" });
    if (roles.includes("WORKER") && profile) await saveWorker(db, principal, workerInput);
    return principal;
  }
  async function denied(action: () => Promise<unknown>, code = "CONFLICT") {
    await assert.rejects(action, (error: unknown) => error instanceof AppError && error.code === code);
  }
  async function move(owner: Principal, job: ManagedJob, action: "publish" | "pause" | "resume" | "close" | "cancel" | "complete") {
    const fresh = await getManagedJob(db, owner, job.id);
    return transitionJob(db, owner, job.id, action, { expectedVersion: fresh.version });
  }
  async function waitForLocks(minimum = 1) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE application_name = ${tag} AND wait_event_type = 'Lock'`;
      if (Number(row.count) >= minimum) return; await delay(10);
    }
    throw new Error("Real PostgreSQL lock contention not observed");
  }
  const skill = await db.skill.findUniqueOrThrow({ where: { slug: "excel" } });
  const workerInput = { headline: "Excel specialist", city: null, bio: "Private profile", timezone: "Asia/Ho_Chi_Minh", preferences: ["PART_TIME"], workModes: ["REMOTE"],
    skills: [{ skillId: skill.id, level: "INTERMEDIATE" }], availability: [{ weekday: 1, startHour: 9, endHour: 12 }] };
  const input: JobInput = { title: "Hiring integration", description: "Structured terms", category: "FINANCE_ACCOUNTING", employmentType: "PART_TIME", workMode: "REMOTE", city: null,
    compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 1,
    startDate: "2026-11-01", endDate: "2026-11-30", timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId: skill.id, required: true, minimumLevel: "INTERMEDIATE" }], schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
  try {
    const owner = await actor(["WORKER", "EMPLOYER"]), manager = await actor(["WORKER", "EMPLOYER"]), other = await actor(["WORKER", "EMPLOYER"]);
    const one = await actor(), two = await actor(), three = await actor(), missing = await actor(["WORKER"], false), restricted = await actor();
    const company = await createCompany(db, owner, { name: "Hiring company", description: "", city: null, website: null, creationKey: randomUUID() }); companies.push(company.id);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    const draft = (override: Partial<JobInput> = {}, companyId: string | null = company.id) => createJob(db, owner, { ...input, ...override, companyId, creationKey: randomUUID() });
    async function published(override: Partial<JobInput> = {}, companyId: string | null = company.id) { return move(owner, await draft(override, companyId), "publish"); }
    const apply = (worker: Principal, job: ManagedJob, key = randomUUID()) => applyToJob(db, worker, job.id, { creationKey: key });
    const shortlist = (applicationId: string, employer = owner) => actOnApplication(db, employer, applicationId, "shortlist", {});
    const offer = (applicationId: string, expiresAt: string | null = null, employer = owner) => createOffer(db, employer, applicationId, { creationKey: randomUUID(), expiresAt });
    stage = "application eligibility, current ownership and lifetime uniqueness";
    let job = await draft(); await denied(() => apply(one, job));
    job = await editJob(db, owner, job.id, { ...input, description: "Before application edit", expectedVersion: job.version });
    job = await move(owner, job, "publish");
    await denied(() => apply(owner, job), "FORBIDDEN"); await denied(() => apply(manager, job), "FORBIDDEN");
    const personal = await published({}, null); await denied(() => apply(owner, personal), "FORBIDDEN");
    await move(owner, personal, "close");
    await denied(() => apply(missing, job), "FORBIDDEN");
    await db.user.update({ where: { id: restricted.id }, data: { emailVerified: false } }); await denied(() => apply(restricted, job), "FORBIDDEN");
    await db.user.update({ where: { id: restricted.id }, data: { emailVerified: true, status: "SUSPENDED" } }); await denied(() => apply(restricted, job), "FORBIDDEN");
    await db.user.update({ where: { id: restricted.id }, data: { status: "ACTIVE" } });
    const profile = await db.workerProfile.findUniqueOrThrow({ where: { userId: restricted.id } });
    await db.workerSkill.deleteMany({ where: { workerProfileId: profile.id } }); await denied(() => apply(restricted, job), "FORBIDDEN");
    await db.workerSkill.create({ data: { workerProfileId: profile.id, skillId: skill.id, level: "BEGINNER" } }); await denied(() => apply(restricted, job), "FORBIDDEN");
    await db.workerSkill.update({ where: { workerProfileId_skillId: { workerProfileId: profile.id, skillId: skill.id } }, data: { level: "EXPERT" } });
    await db.workerAvailability.deleteMany({ where: { workerProfileId: profile.id } }); await denied(() => apply(restricted, job), "FORBIDDEN");
    await saveWorker(db, restricted, workerInput, profile.id);
    const key = randomUUID(), a = await apply(one, job, key), b = await apply(two, job), unrelated = await apply(other, job);
    assert.equal((await apply(one, job, key)).id, a.id); await denied(() => apply(one, job));
    await actOnApplication(db, other, unrelated.id, "withdraw", {}); await denied(() => apply(other, job));
    assert.equal((await getApplication(db, one, "WORKER", a.id)).status, "APPLIED");
    await denied(() => getApplication(db, two, "WORKER", a.id), "NOT_FOUND"); await denied(() => getApplication(db, other, "EMPLOYER", a.id), "NOT_FOUND");
    await denied(() => applyToJob(db, one, job.id, { creationKey: randomUUID(), workerProfileId: profile.id }), "VALIDATION");
    await denied(() => actOnApplication(db, owner, a.id, "shortlist", { status: "ACCEPTED" }), "VALIDATION");
    assert.equal((await listApplications(db, owner, "EMPLOYER", { limit: 1 }, job.id)).items.length, 1);
    assert.equal((await getApplication(db, owner, "EMPLOYER", a.id)).status, "APPLIED");
    await actOnApplication(db, owner, a.id, "view", {}); await shortlist(a.id); await shortlist(b.id);
    stage = "real material edit facts, offer immutability/revisions and privacy";
    const mutations: Partial<JobInput>[] = [{ compensationMin: "60000" }, { city: "hà nội" }, { employmentType: "FULL_TIME" }, { startDate: "2026-11-02" }, { endDate: "2026-12-01" }, { schedule: [{ weekday: 2, startHour: 9, endHour: 17 }] }, { title: "Changed" }, { skills: [] }, { category: "MARKETING" }, { headcount: 2 }];
    for (const change of mutations) await denied(() => editJob(db, owner, job.id, { ...input, ...change, expectedVersion: job.version }));
    job = await editJob(db, owner, job.id, { ...input, description: "Description only", expectedVersion: job.version });
    await denied(() => offer(a.id, null, other), "NOT_FOUND");
    let oa = await offer(a.id); const ob = await offer(b.id, null, manager);
    await denied(() => offer(a.id)); await denied(() => actOnApplication(db, owner, a.id, "reject", {}));
    await assert.rejects(() => db.offer.update({ where: { id: oa.id }, data: { terms: {} } }));
    await assert.rejects(() => db.offer.create({ data: { applicationId: a.id, jobId: job.id, creationKey: randomUUID(), revision: 99, status: "REVOKED", resolvedAt: new Date(), terms: {} } }));
    const rawOffer = await db.offer.findUniqueOrThrow({ where: { id: oa.id } });
    await assert.rejects(() => db.offer.create({ data: { applicationId: a.id, jobId: job.id, creationKey: randomUUID(), revision: 99, terms: rawOffer.terms! } }));
    await denied(() => actOnOffer(db, two, oa.id, "accept", {}), "NOT_FOUND");
    await actOnOffer(db, owner, oa.id, "revoke", {}); await denied(() => actOnOffer(db, one, oa.id, "accept", {}));
    oa = await offer(a.id); assert.equal(oa.revision, 2);
    await actOnOffer(db, one, oa.id, "decline", {}); await denied(() => actOnOffer(db, one, oa.id, "accept", {}));
    oa = await offer(a.id); assert.equal(oa.revision, 3);
    const remaining = await apply(three, job); await shortlist(remaining.id); const remainingOffer = await offer(remaining.id);
    const privacy = JSON.stringify(await getApplication(db, owner, "EMPLOYER", a.id));
    for (const forbidden of [one.email, one.id, "ownerId", "workerProfileId", "availability\": [", "session", "cancelledBy"]) assert.ok(!privacy.includes(forbidden));
    assert.equal((await listOffers(db, one, "WORKER", a.id, { limit: 1 })).items.length, 1);
    stage = "closed pending offers, last-slot PostgreSQL concurrency and idempotency";
    job = await move(owner, job, "close"); await denied(() => apply(three, job));
    const rejected = await apply(restricted, await published({ headcount: 2 }));
    const rejectedJob = await getManagedJob(db, owner, rejected.job.id);
    await actOnApplication(db, owner, rejected.id, "reject", {}); await denied(() => apply(restricted, rejectedJob)); await move(owner, rejectedJob, "cancel");
    let accepts: Promise<PromiseSettledResult<Awaited<ReturnType<typeof actOnOffer>>>[]> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${job.id} FOR UPDATE`;
      accepts = Promise.allSettled([actOnOffer(db, one, oa.id, "accept", {}), actOnOffer(db, two, ob.id, "accept", {})]);
      // First contender owns Company while waiting on Job; second waits on Company.
      await waitForLocks(2);
    });
    const results = await accepts!; assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await db.engagement.count({ where: { jobId: job.id } }), 1);
    const firstWins = results[0].status === "fulfilled", winner = firstWins ? one : two, loser = firstWins ? two : one;
    const winnerOffer = firstWins ? oa : ob, loserOffer = firstWins ? ob : oa;
    await db.user.update({ where: { id: winner.id }, data: { status: "SUSPENDED" } });
    await denied(() => actOnOffer(db, winner, winnerOffer.id, "accept", {}), "FORBIDDEN");
    await db.user.update({ where: { id: winner.id }, data: { status: "ACTIVE" } });
    let accepted = await actOnOffer(db, winner, winnerOffer.id, "accept", {}); assert.ok(accepted.engagement);
    const engagementId = accepted.engagement!.id;
    assert.equal((await actOnOffer(db, winner, winnerOffer.id, "accept", {})).engagement!.id, engagementId);
    await denied(() => offer(accepted.id)); await denied(() => actOnOffer(db, owner, winnerOffer.id, "revoke", {}));
    await denied(() => actOnApplication(db, winner, accepted.id, "withdraw", {})); await denied(() => move(owner, job, "cancel"));
    await denied(() => actOnEngagement(db, winner, "WORKER", engagementId, "start", {}), "FORBIDDEN");
    await denied(() => actOnEngagement(db, owner, "EMPLOYER", engagementId, "confirm-completion", {}));
    await actOnEngagement(db, winner, "WORKER", engagementId, "cancel", { category: "PERSONAL", reason: "Test cancellation" });
    assert.equal(await db.engagement.count({ where: { jobId: job.id, status: { in: ["ACCEPTED", "IN_PROGRESS", "COMPLETED"] } } }), 0);
    accepted = await actOnOffer(db, loser, loserOffer.id, "accept", {}); const secondId = accepted.engagement!.id;
    const originalSnapshot = accepted.engagement!.terms;
    await db.company.update({ where: { id: company.id }, data: { name: "Renamed company" } });
    await db.user.update({ where: { id: loser.id }, data: { name: "Renamed worker", status: "SUSPENDED" } });
    await denied(() => actOnEngagement(db, owner, "EMPLOYER", secondId, "confirm-completion", {}));
    await actOnEngagement(db, manager, "EMPLOYER", secondId, "start", {});
    const requested = await actOnEngagement(db, loser, "WORKER", secondId, "request-completion", {});
    assert.equal(requested.engagement!.status, "IN_PROGRESS");
    assert.equal((await actOnEngagement(db, loser, "WORKER", secondId, "request-completion", {})).engagement!.completionRequestedAt, requested.engagement!.completionRequestedAt);
    await actOnEngagement(db, manager, "EMPLOYER", secondId, "confirm-completion", {});
    assert.deepEqual((await getApplication(db, loser, "WORKER", accepted.id)).engagement!.terms, originalSnapshot);
    await assert.rejects(() => db.engagement.update({ where: { id: secondId }, data: { terms: {} } }));
    await denied(() => actOnEngagement(db, owner, "EMPLOYER", secondId, "cancel", { category: "OTHER", reason: "No" }));
    await db.user.update({ where: { id: loser.id }, data: { status: "ACTIVE" } });
    assert.equal(await db.engagement.count({ where: { jobId: job.id, status: "COMPLETED" } }), 1);
    stage = "expiry race, cleanup, no-new-offers after close and current membership";
    stage = "expiry race setup";
    let expiryJob = await published({ headcount: 3 });
    stage = "expiry race apply";
    const expApp = await apply(three, expiryJob); await shortlist(expApp.id);
    stage = "expiry race offer creation";
    const exp = await offer(expApp.id, new Date(Date.now() + 3000).toISOString());
    let expiredAttempt: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${expiryJob.id} FOR UPDATE`;
      expiredAttempt = actOnOffer(db, three, exp.id, "accept", {}).catch((error: unknown) => error);
      await waitForLocks(); await delay(3100);
    });
    stage = "expiry race persisted normalization";
    assert.ok(await expiredAttempt instanceof AppError);
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: exp.id } })).status, "EXPIRED");
    assert.equal((await db.application.findUniqueOrThrow({ where: { id: expApp.id } })).status, "SHORTLISTED");
    stage = "expiry revision and CLOSED offer denial";
    const revised = await offer(expApp.id); assert.equal(revised.revision, 2);
    await actOnOffer(db, three, revised.id, "decline", {});
    const readExpiry = await offer(expApp.id, new Date(Date.now() + 1200).toISOString());
    await delay(1300);
    const effectiveShortlist = await listApplications(db, three, "WORKER", { status: "SHORTLISTED" });
    assert.ok(effectiveShortlist.items.some((row) => row.id === expApp.id && row.offer?.status === "EXPIRED"));
    assert.ok(!(await listApplications(db, three, "WORKER", { status: "OFFERED" })).items.some((row) => row.id === expApp.id));
    assert.equal((await getApplication(db, three, "WORKER", expApp.id)).offer!.status, "EXPIRED");
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: readExpiry.id } })).status, "EXPIRED");
    expiryJob = await move(owner, expiryJob, "close"); await denied(() => offer(expApp.id));
    await move(owner, expiryJob, "cancel"); await denied(() => apply(three, expiryJob));
    assert.equal((await getApplication(db, three, "WORKER", expApp.id)).status, "CANCELLED");
    stage = "Job cancellation cleanup";
    const cleanupJob = await published({ headcount: 3 });
    const cleanupApp = await apply(three, cleanupJob); await shortlist(cleanupApp.id); const cleanupOffer = await offer(cleanupApp.id);
    const withdrawApp = await apply(restricted, cleanupJob); await shortlist(withdrawApp.id); const withdrawOffer = await offer(withdrawApp.id);
    await actOnApplication(db, restricted, withdrawApp.id, "withdraw", {});
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: withdrawOffer.id } })).status, "REVOKED");
    await denied(() => apply(restricted, cleanupJob));
    await move(owner, cleanupJob, "cancel");
    assert.equal((await getApplication(db, three, "WORKER", cleanupApp.id)).status, "CANCELLED");
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: cleanupOffer.id } })).status, "REVOKED");
    await denied(() => actOnOffer(db, three, cleanupOffer.id, "accept", {}));
    await denied(() => apply(three, cleanupJob));
    // Completed slots remain occupied while recruitment is otherwise allowed.
    stage = "completed engagement still occupies published capacity";
    const full = await published(); const fullApp = await apply(three, full); await shortlist(fullApp.id); const fullOffer = await offer(fullApp.id);
    const fullAccepted = await actOnOffer(db, three, fullOffer.id, "accept", {}); const fullId = fullAccepted.engagement!.id;
    await actOnEngagement(db, owner, "EMPLOYER", fullId, "start", {}); await actOnEngagement(db, three, "WORKER", fullId, "request-completion", {}); await actOnEngagement(db, owner, "EMPLOYER", fullId, "confirm-completion", {});
    await denied(() => apply(restricted, full)); await denied(() => move(owner, full, "complete"));
    const cleanupBefore = await apply(restricted, await published({ headcount: 2 }));
    await move(owner, await getManagedJob(db, owner, cleanupBefore.job.id), "cancel");
    stage = "explicit Job completion";
    await move(owner, full, "close"); await move(owner, full, "complete");
    assert.equal((await actOnOffer(db, three, fullOffer.id, "accept", {})).engagement!.id, fullId);
    await move(owner, job, "complete");
    assert.equal((await db.application.findUniqueOrThrow({ where: { id: remaining.id } })).status, "CANCELLED");
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: remainingOffer.id } })).status, "REVOKED");
    await denied(() => actOnOffer(db, three, remainingOffer.id, "accept", {}));
    stage = "headcount below real occupied slots and immutable relational constraints";
    const twoSlotJob = await published({ headcount: 2 });
    const slotA = await apply(one, twoSlotJob), slotB = await apply(two, twoSlotJob);
    await shortlist(slotA.id); await shortlist(slotB.id);
    const slotOfferA = await offer(slotA.id), slotOfferB = await offer(slotB.id);
    const slotAcceptedA = await actOnOffer(db, one, slotOfferA.id, "accept", {});
    await actOnOffer(db, two, slotOfferB.id, "accept", {});
    await denied(() => editJob(db, owner, twoSlotJob.id, { ...input, headcount: 1, expectedVersion: twoSlotJob.version }));
    const rawEngagement = await db.engagement.findUniqueOrThrow({ where: { id: slotAcceptedA.engagement!.id } });
    await assert.rejects(() => db.engagement.create({ data: { applicationId: slotA.id, acceptedOfferId: slotOfferA.id, jobId: twoSlotJob.id, workerProfileId: rawEngagement.workerProfileId, terms: rawEngagement.terms! } }));
    await assert.rejects(() => db.offer.create({ data: { applicationId: slotA.id, jobId: full.id, creationKey: randomUUID(), revision: 99, terms: rawOffer.terms! } }));
    await actOnEngagement(db, one, "WORKER", slotAcceptedA.engagement!.id, "cancel", { category: "OTHER", reason: "Fixture finishes" });
    const slotAcceptedB = await getApplication(db, two, "WORKER", slotB.id);
    await actOnEngagement(db, owner, "EMPLOYER", slotAcceptedB.engagement!.id, "cancel", { category: "OTHER", reason: "Fixture finishes" });
    await move(owner, twoSlotJob, "cancel");
    stage = "fresh verification/status, own membership and pending acceptance";
    const guardedJob = await published({ headcount: 3 });
    const guarded = await apply(restricted, guardedJob); await shortlist(guarded.id);
    await db.user.update({ where: { id: owner.id }, data: { emailVerified: false } }); await denied(() => offer(guarded.id), "FORBIDDEN");
    await db.user.update({ where: { id: owner.id }, data: { emailVerified: true, status: "SUSPENDED" } }); await denied(() => offer(guarded.id), "FORBIDDEN");
    await db.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });
    const guardedOffer = await offer(guarded.id);
    await db.user.update({ where: { id: restricted.id }, data: { emailVerified: false } }); await denied(() => actOnOffer(db, restricted, guardedOffer.id, "accept", {}), "FORBIDDEN");
    await db.user.update({ where: { id: restricted.id }, data: { emailVerified: true } });
    await db.companyMember.create({ data: { companyId: company.id, userId: restricted.id, role: "MANAGER" } });
    await denied(() => actOnOffer(db, restricted, guardedOffer.id, "accept", {}), "FORBIDDEN");
    await db.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: restricted.id } } });
    let suspendedAccept: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${restricted.id} FOR UPDATE`;
      suspendedAccept = actOnOffer(db, restricted, guardedOffer.id, "accept", {}).catch((error: unknown) => error);
      await waitForLocks(); await tx.user.update({ where: { id: restricted.id }, data: { status: "SUSPENDED" } });
    });
    const blockedAccept = await suspendedAccept; assert.ok(blockedAccept instanceof AppError && blockedAccept.code === "FORBIDDEN");
    assert.equal(await db.engagement.count({ where: { applicationId: guarded.id } }), 0);
    await db.user.update({ where: { id: restricted.id }, data: { status: "ACTIVE" } });
    const revokeRaceApp = await apply(three, guardedJob); await shortlist(revokeRaceApp.id);
    let removedOffer: Promise<unknown> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${company.id} FOR UPDATE`;
      removedOffer = offer(revokeRaceApp.id, null, manager).catch((error: unknown) => error);
      await waitForLocks(); await tx.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: manager.id } } });
    });
    const blockedOffer = await removedOffer; assert.ok(blockedOffer instanceof AppError && blockedOffer.code === "NOT_FOUND");
    assert.equal(await db.offer.count({ where: { applicationId: revokeRaceApp.id } }), 0);
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    await move(owner, guardedJob, "cancel");
    // Membership removal uses the same Company lock and revokes all management authority.
    stage = "current membership revocation";
    await removeManager(db, owner, company.id, manager.id);
    await denied(() => getApplication(db, manager, "EMPLOYER", a.id), "NOT_FOUND");
    await denied(() => createOffer(db, manager, a.id, { creationKey: randomUUID(), expiresAt: null }), "NOT_FOUND");
    // Creator provenance does not grant authority after departure, nor prevent later self-apply.
    stage = "departed creator company application";
    const departureJob = await published({ headcount: 2 });
    await db.companyMember.create({ data: { companyId: company.id, userId: manager.id, role: "MANAGER" } });
    await db.companyMember.delete({ where: { companyId_userId: { companyId: company.id, userId: owner.id } } });
    const departedApplication = await apply(owner, departureJob);
    await denied(() => getApplication(db, owner, "EMPLOYER", departedApplication.id), "NOT_FOUND");
    await shortlist(departedApplication.id, manager);
    assert.equal((await getApplication(db, manager, "EMPLOYER", departedApplication.id)).status, "SHORTLISTED");
    // Optional missing skill is not an eligibility gate.
    stage = "optional skills and database history constraints";
    const optionalSkill = await db.skill.findFirstOrThrow({ where: { id: { not: skill.id }, active: true } });
    const optional = await createJob(db, other, { ...input, companyId: null, creationKey: randomUUID(), skills: [{ skillId: optionalSkill.id, required: false, minimumLevel: "EXPERT" }] });
    const optionalPublished = await move(other, optional, "publish"); await apply(restricted, optionalPublished);
    await assert.rejects(() => db.application.create({ data: { jobId: optional.id, workerProfileId: profile.id, creationKey: randomUUID() } }));
    await assert.rejects(() => db.job.delete({ where: { id: optional.id } }));
    console.info("PASS: Phase 5 PostgreSQL application/eligibility/ownership/uniqueness, immutable offer revisions, atomic acceptance/last-slot concurrency, expiry race, engagement obligations, lifecycle cleanup, material edits, IDOR/privacy and history constraints.");
  } catch (error) {
    if (error instanceof AppError) console.error(`Policy failure code: ${error.code}`);
    console.error(`FAIL: hiring PostgreSQL verification at ${stage}; sensitive diagnostics suppressed.`); process.exitCode = 1;
  } finally {
    try {
      const jobIds = (await db.job.findMany({ where: { createdByUserId: { in: users } }, select: { id: true } })).map((row) => row.id);
      await db.engagement.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.offer.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.application.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.jobSkill.deleteMany({ where: { jobId: { in: jobIds } } }); await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: jobIds } } }); await db.job.deleteMany({ where: { id: { in: jobIds } } });
      await db.companyMember.deleteMany({ where: { companyId: { in: companies } } }); await db.company.deleteMany({ where: { id: { in: companies } } });
      await db.workerProfile.deleteMany({ where: { userId: { in: users } } }); await db.employerProfile.deleteMany({ where: { userId: { in: users } } });
      await db.userRole.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
    } catch { console.error("FAIL: hiring fixture cleanup; sensitive diagnostics suppressed."); process.exitCode = 1; }
    await db.$disconnect();
  }
}
