import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { testDatabase } from "./test-database";
import { cleanupModerationFixtures } from "./moderation-test-cleanup";
import { transaction } from "../src/shared/db/transaction";
import { consumeRate } from "../src/shared/security/rate-limit";
import { createAuth } from "../src/modules/auth/factory";
import { currentActor } from "../src/modules/auth/transaction";
import type { Principal, Role } from "../src/modules/auth/policy";
import { AppError } from "../src/shared/errors/app-error";
import { saveEmployer, saveWorker } from "../src/modules/profiles/service";
import { createJob, transitionJob, listManagedJobs } from "../src/modules/jobs/service";
import { applyToJob, actOnApplication, createOffer, actOnOffer, actOnEngagement, getApplication, listOffers } from "../src/modules/hiring/service";
import { openConversation, sendMessage, listConversations, listMessages } from "../src/modules/messaging/service";
import { submitReview } from "../src/modules/reviews/service";
import { getWorkerReputationFacts } from "../src/modules/reviews/query";
import { createReport, createCase, actOnCase, progressCase, caseReports, listCases } from "../src/modules/moderation/service";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: hardening needs an explicit disposable TEST_DATABASE_URL."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = testDatabase(process.env);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 12 }), log: [{ level: "query", emit: "event" }] });
  let queries = 0, stage = "fixtures"; db.$on("query", () => { queries++; });
  const users: string[] = [], extraRateKeys: string[] = [];
  const reason = { reasonCode: "OTHER" as const, reason: "Hardening fixture investigation" };
  const failure = new Error("Injected test-only rollback");
  const started = performance.now();
  function fault(model: string, operation: string) {
    // Test-only fault AFTER a real DB write, inside the real transaction. No app flag.
    return db.$extends({ query: { $allModels: { async $allOperations({ model: current, operation: op, args, query }) {
      const result = await query(args); if (current === model && op === operation) throw failure; return result;
    } } } }) as unknown as PrismaClient;
  }
  async function denied(fn: () => Promise<unknown>, code: string) { await assert.rejects(fn, (e: unknown) => e instanceof AppError && e.code === code); }
  try {
    const skillId = (await db.skill.findUniqueOrThrow({ where: { slug: "excel" } })).id;
    async function actor(roles: Role[]) {
      const id = randomUUID(); users.push(id);
      await db.user.create({ data: { id, name: "Hardening fixture", email: `${id}@example.invalid`, emailVerified: true, roles: { create: roles.map((role) => ({ role, grantedBy: "test-fixture" })) } } });
      const a: Principal = { id, name: "Hardening fixture", email: `${id}@example.invalid`, emailVerified: true, status: "ACTIVE", roles };
      if (roles.includes("EMPLOYER")) await saveEmployer(db, a, { type: "INDIVIDUAL", description: "", city: null });
      if (roles.includes("WORKER")) await saveWorker(db, a, { headline: "Excel", bio: "", city: null, preferences: ["FULL_TIME"], workModes: ["REMOTE"], skills: [{ skillId, level: "INTERMEDIATE" }], availability: [] });
      return a;
    }
    const owner = await actor(["WORKER", "EMPLOYER"]), worker = await actor(["WORKER", "EMPLOYER"]), second = await actor(["WORKER"]), foreign = await actor(["WORKER", "EMPLOYER"]), admin = await actor(["ADMIN"]), admin2 = await actor(["ADMIN"]);
    const input = { title: "Hardening Excel tiếng Việt", description: "Synthetic work", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: null,
      compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 1, startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId, required: true, minimumLevel: "BEGINNER" }], schedule: [] };
    const draft = () => createJob(db, owner, { ...input, companyId: null, creationKey: randomUUID() });
    const j = await draft(); await transitionJob(db, owner, j.id, "publish", { expectedVersion: j.version });
    const application = await applyToJob(db, worker, j.id, { creationKey: randomUUID() });
    stage = "dual roles and fresh status matrix";
    await denied(() => getApplication(db, foreign, "WORKER", application.id), "NOT_FOUND");
    await denied(() => getApplication(db, worker, "EMPLOYER", application.id), "NOT_FOUND");
    await denied(() => applyToJob(db, owner, j.id, { creationKey: randomUUID() }), "FORBIDDEN");
    for (const status of ["ACTIVE", "SUSPENDED", "BANNED"] as const) {
      await db.user.update({ where: { id: foreign.id }, data: { status } });
      for (const mutation of [false, true]) {
        const run = () => db.$transaction((tx) => currentActor(tx, foreign, "WORKER", mutation, true));
        if (status === "ACTIVE" || (status === "SUSPENDED" && !mutation)) await run(); else await denied(run, "FORBIDDEN");
      }
      await db.$transaction((tx) => currentActor(tx, foreign, "WORKER", false, true, "privacy-opt-out"));
    }
    await db.user.update({ where: { id: foreign.id }, data: { status: "ACTIVE" } });
    stage = "atomic rate races, namespaces and provider shared storage";
    const rateKey = `hardening:${randomUUID()}`; extraRateKeys.push(rateKey);
    const race = await Promise.all(Array.from({ length: 24 }, () => consumeRate(db, rateKey, { window: 3600, max: 7 })));
    assert.equal(race.filter((r) => r.allowed).length, 7); assert.equal((await db.rateLimit.findUniqueOrThrow({ where: { key: rateKey } })).count, 7);
    const oldReport = `report:user:${foreign.id}`;
    await db.rateLimit.create({ data: { id: randomUUID(), key: oldReport, count: 10, lastRequest: BigInt(Date.now() - 120000) } });
    const auth = createAuth(db, { origin: "http://localhost:3099", secret: randomUUID().repeat(2), production: false }, { async send() {} });
    const authKey = `hardening-auth-${randomUUID()}`; extraRateKeys.push(authKey);
    await db.rateLimit.create({ data: { id: randomUUID(), key: authKey, count: 5, lastRequest: BigInt(Date.now() - 120000) } });
    const storage = auth.options.rateLimit!.customStorage!;
    const authRace = await Promise.all(Array.from({ length: 12 }, () => storage.consume(authKey, { window: 60, max: 5 })));
    assert.equal(authRace.filter((r) => r.allowed).length, 5);
    assert.equal((await db.rateLimit.findUniqueOrThrow({ where: { key: oldReport } })).count, 10); // Auth cannot prune report budget.
    const reports = await Promise.all(Array.from({ length: 8 }, () => createReport(db, worker, { targetType: "JOB", targetId: j.id, reasonCode: "SPAM", details: null })));
    assert.equal(new Set(reports.map((r) => r.id)).size, 1);
    assert.equal((await db.rateLimit.findUniqueOrThrow({ where: { key: `report:user:${worker.id}` } })).count, 1);
    stage = "real PostgreSQL aborted-transaction retry and exhaustion";
    let attempts = 0;
    await transaction(db, async (tx) => {
      attempts++; await tx.rateLimit.update({ where: { key: rateKey }, data: { count: { increment: 1 } } });
      if (attempts < 3) await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'fixture abort' USING ERRCODE='40001'; END $$`;
    });
    assert.equal(attempts, 3); assert.equal((await db.rateLimit.findUniqueOrThrow({ where: { key: rateKey } })).count, 8);
    attempts = 0;
    await assert.rejects(() => transaction(db, async (tx) => { attempts++; await tx.$executeRaw`DO $$ BEGIN RAISE EXCEPTION 'fixture deadlock abort' USING ERRCODE='40P01'; END $$`; }));
    assert.equal(attempts, 3);
    // Force a genuine two-connection cycle; the aborted participant is retried.
    const lockKeys = [rateKey, authKey]; let arrived = 0, unlock!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; }); const calls = [0,0];
    await Promise.all([0,1].map((side) => transaction(db, async (tx) => {
      calls[side]++;
      await tx.$queryRaw`SELECT id FROM "RateLimit" WHERE key=${lockKeys[side]} FOR UPDATE`;
      if (calls[side] === 1) { if (++arrived === 2) unlock(); await barrier; }
      await tx.$queryRaw`SELECT id FROM "RateLimit" WHERE key=${lockKeys[1-side]} FOR UPDATE`;
    })));
    assert(calls.some((n) => n > 1)); assert(calls.every((n) => n <= 3));
    stage = "offer acceptance and message notification failure rollback";
    await actOnApplication(db, owner, application.id, "shortlist", {});
    const offer = await createOffer(db, owner, application.id, { creationKey: randomUUID(), expiresAt: null });
    await assert.rejects(() => actOnOffer(fault("Engagement", "create"), worker, offer.id, "accept", {}), (e) => e === failure);
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: offer.id } })).status, "PENDING");
    assert.equal((await db.application.findUniqueOrThrow({ where: { id: application.id } })).status, "OFFERED");
    assert.equal(await db.engagement.count({ where: { applicationId: application.id } }), 0);
    const app2 = await applyToJob(db, second, j.id, { creationKey: randomUUID() }); await actOnApplication(db, owner, app2.id, "shortlist", {});
    const offer2 = await createOffer(db, owner, app2.id, { creationKey: randomUUID(), expiresAt: null });
    const accepted = await Promise.allSettled([actOnOffer(db, worker, offer.id, "accept", {}), actOnOffer(db, second, offer2.id, "accept", {})]);
    assert.equal(accepted.filter((r) => r.status === "fulfilled").length, 1);
    const winner = accepted[0].status === "fulfilled" ? worker : second;
    const winningApp = accepted[0].status === "fulfilled" ? application : app2;
    const engagement = (await getApplication(db, winner, "WORKER", winningApp.id)).engagement!;
    const chat = await openConversation(db, winner, "WORKER", winningApp.id, {});
    const beforeMessages = await db.message.count({ where: { conversationId: chat.id } });
    const send = { body: "Rollback message", creationKey: randomUUID() };
    await assert.rejects(() => sendMessage(fault("Notification", "create"), winner, "WORKER", chat.id, send), (e) => e === failure);
    assert.equal(await db.message.count({ where: { conversationId: chat.id } }), beforeMessages);
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: chat.id } })).lastMessageAt, null);
    const messageKeys = [`message:user:${winner.id}`, `message:conversation:${winner.id}:${chat.id}`];
    assert.equal(await db.rateLimit.count({ where: { key: { in: messageKeys } } }), 0);
    const sent = await Promise.all([sendMessage(db, winner, "WORKER", chat.id, send), sendMessage(db, winner, "WORKER", chat.id, send)]);
    assert.equal(sent[0].id, sent[1].id);
    assert((await db.rateLimit.findMany({ where: { key: { in: messageKeys } } })).every((row) => row.count === 1));
    stage = "review rollback and audit/effect rollback";
    await actOnEngagement(db, owner, "EMPLOYER", engagement.id, "start", {});
    await actOnEngagement(db, winner, "WORKER", engagement.id, "request-completion", {});
    await actOnEngagement(db, owner, "EMPLOYER", engagement.id, "confirm-completion", {});
    const reviewInput = { rating: 5, comment: "Tiếng Việt", creationKey: randomUUID() };
    await assert.rejects(() => submitReview(fault("Review", "create"), winner, "WORKER", engagement.id, reviewInput), (e) => e === failure);
    assert.equal(await db.review.count({ where: { engagementId: engagement.id } }), 0);
    await submitReview(db, winner, "WORKER", engagement.id, reviewInput);
    const c = await createCase(db, admin, { ...reason, targetType: "JOB", targetId: j.id, severity: "HIGH", reportId: reports[0].id });
    await denied(() => actOnCase(db, admin, c.id, "hide-job", { ...reason, targetId: "not-a-uuid" }), "VALIDATION");
    const audits = await db.auditEvent.count({ where: { caseId: c.id } });
    await assert.rejects(() => actOnCase(fault("AuditEvent", "create"), admin, c.id, "hide-job", { ...reason, targetId: j.id }), (e) => e === failure);
    assert.equal(await db.auditEvent.count({ where: { caseId: c.id } }), audits);
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: j.id } })).moderationHiddenAt, null);
    await denied(() => caseReports(db, admin, c.id, { cursor: randomUUID() }), "VALIDATION");
    stage = "case close versus resource action";
    await Promise.allSettled([progressCase(db, admin, c.id, "close", { ...reason, resolutionCode: "RESOLVED" }), actOnCase(db, admin2, c.id, "hide-job", { ...reason, targetId: j.id })]);
    assert.equal((await db.moderationCase.findUniqueOrThrow({ where: { id: c.id } })).status, "CLOSED");
    const auditAfterClose = await db.auditEvent.count({ where: { caseId: c.id } });
    await denied(() => actOnCase(db, admin, c.id, "hide-job", { ...reason, targetId: j.id }), "CONFLICT");
    assert.equal(await db.auditEvent.count({ where: { caseId: c.id } }), auditAfterClose);
    stage = "quota boundary and write-free expired GET";
    const drafts = await Promise.all([draft(), draft(), draft()]);
    const published = await Promise.allSettled(drafts.map((d) => transitionJob(db, owner, d.id, "publish", { expectedVersion: d.version })));
    assert.equal(published.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal(await db.job.count({ where: { createdByUserId: owner.id, status: { in: ["PUBLISHED", "PAUSED"] } } }), 3);
    const expiryJob = drafts[published.findIndex((r) => r.status === "fulfilled")];
    const expApp = await applyToJob(db, foreign, expiryJob.id, { creationKey: randomUUID() }); await actOnApplication(db, owner, expApp.id, "shortlist", {});
    const expOffer = await createOffer(db, owner, expApp.id, { creationKey: randomUUID(), expiresAt: new Date(Date.now()+1500).toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const beforeRead = await db.offer.findUniqueOrThrow({ where: { id: expOffer.id } });
    assert.equal((await getApplication(db, foreign, "WORKER", expApp.id)).offer!.status, "EXPIRED");
    assert.equal((await listOffers(db, foreign, "WORKER", expApp.id, {})).items[0].status, "EXPIRED");
    assert.deepEqual(await db.offer.findUniqueOrThrow({ where: { id: expOffer.id } }), beforeRead);
    stage = "synthetic dataset and query-count guards";
    const employerId = (await db.employerProfile.findUniqueOrThrow({ where: { userId: owner.id } })).id;
    await db.job.createMany({ data: Array.from({ length: 240 }, () => ({ id: randomUUID(), createdByUserId: owner.id, employerProfileId: employerId, creationKey: randomUUID(), title: "Synthetic draft" })) });
    const oneStart = queries; await listConversations(db, owner, "EMPLOYER", { limit: 1 }); const oneQueries = queries-oneStart;
    const bulk = Array.from({ length: 40 }, () => ({ id: randomUUID(), profile: randomUUID(), app: randomUUID(), conversation: randomUUID() })); users.push(...bulk.map((r) => r.id));
    await db.user.createMany({ data: bulk.map((r) => ({ id:r.id, name:"Synthetic worker", email:`${r.id}@example.invalid`, emailVerified:true })) });
    await db.userRole.createMany({ data: bulk.map((r) => ({ userId:r.id, role:"WORKER", grantedBy:"test-fixture" })) });
    await db.workerProfile.createMany({ data: bulk.map((r) => ({ id:r.profile, userId:r.id })) });
    await db.application.createMany({ data: bulk.map((r) => ({ id:r.app, jobId:expiryJob.id, workerProfileId:r.profile, creationKey:randomUUID() })) });
    await db.conversation.createMany({ data: bulk.map((r) => ({ id:r.conversation, applicationId:r.app, jobId:expiryJob.id, workerProfileId:r.profile })) });
    const time = Date.now()-100000;
    await db.message.createMany({ data: bulk.flatMap((r) => Array.from({ length: 50 }, (_,i) => ({ conversationId:r.conversation, senderUserId:r.id, senderSide:"WORKER" as const, body:"Synthetic plain text", creationKey:randomUUID(), createdAt:new Date(time+i) }))) });
    const manyStart = queries; const inbox = await listConversations(db, owner, "EMPLOYER", { limit: 30 }); const manyQueries = queries-manyStart;
    assert.equal(inbox.items.length,30); assert(manyQueries <= oneQueries+4, "Inbox query count must not grow per conversation");
    const p1 = await listManagedJobs(db,owner,{limit:12}); await draft();
    const p2 = await listManagedJobs(db,owner,{limit:12,cursor:p1.nextCursor!}); assert(!p1.items.some((a)=>p2.items.some((b)=>a.id===b.id)));
    const msgPage = await listMessages(db,owner,"EMPLOYER",bulk[0].conversation,{limit:20});
    const newId=randomUUID(); await db.message.create({data:{id:newId,conversationId:bulk[0].conversation,senderUserId:bulk[0].id,senderSide:"WORKER",body:"Inserted between pages",creationKey:randomUUID()}});
    const newer=await listMessages(db,owner,"EMPLOYER",bulk[0].conversation,{after:msgPage.newest!,limit:20}); assert(newer.items.some((m)=>m.id===newId));
    await denied(()=>listMessages(db,owner,"EMPLOYER",bulk[1].conversation,{after:newId}),"VALIDATION");
    const adminOne=queries; await listCases(db,admin,{limit:1}); const adminQueries=queries-adminOne;
    for(let i=0;i<25;i++) await createCase(db,admin,{...reason,targetType:"JOB",targetId:j.id,severity:"LOW"});
    const adminMany=queries; assert.equal((await listCases(db,admin,{limit:20})).items.length,20); assert(queries-adminMany<=adminQueries+2);
    const factsOne=queries; await db.$transaction(tx=>getWorkerReputationFacts(tx,[bulk[0].profile])); const factsQueries=queries-factsOne;
    const factsMany=queries; await db.$transaction(tx=>getWorkerReputationFacts(tx,bulk.map(r=>r.profile))); assert(queries-factsMany<=factsQueries+1);
    console.info(`PASS: synthetic 240 drafts/40 workers/2001 messages; inbox queries ${oneQueries}/${manyQueries}, admin ${adminQueries}, reputation ${factsQueries}; elapsed ${Math.round(performance.now()-started)}ms (local smoke, no SLA).`);
    stage="critical EXPLAIN plans";
    const plans = [
      Prisma.sql`SELECT id FROM "Job" WHERE status='PUBLISHED' AND "moderationHiddenAt" IS NULL AND "searchVector" @@ plainto_tsquery('simple','Excel') ORDER BY "publishedAt" DESC,id LIMIT 30`,
      Prisma.sql`SELECT count(*) FROM "Engagement" WHERE "jobId"=${j.id} AND status IN ('ACCEPTED','IN_PROGRESS','COMPLETED')`,
      Prisma.sql`SELECT id FROM "Message" WHERE "conversationId"=${bulk[0].conversation} ORDER BY "createdAt" DESC,id DESC LIMIT 50`,
      Prisma.sql`SELECT "workerProfileId",sum(rating),count(*) FROM "Review" WHERE "workerProfileId" IN (${Prisma.join(bulk.map(r=>r.profile))}) AND direction='EMPLOYER_TO_WORKER' AND "hiddenAt" IS NULL GROUP BY "workerProfileId"`,
      Prisma.sql`SELECT id FROM "ModerationCase" WHERE status='OPEN' AND severity='LOW' ORDER BY id LIMIT 20`,
    ];
    for(let i=0;i<plans.length;i++) {
      const plan=await db.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL enable_seqscan=off`; return tx.$queryRaw<Record<string,unknown>[]>(Prisma.sql`EXPLAIN (FORMAT JSON) ${plans[i]}`);});
      assert(/Index|Bitmap/.test(JSON.stringify(plan)),"Expected index-capable critical query");
      console.info(`PASS: critical plan ${i+1} index-capable (planner choice on tiny fixtures is not a production benchmark).`);
    }
    stage="integrity SQL";
    const [integrity]=await db.$queryRaw<{bad:bigint}[]>`SELECT (
      (SELECT count(*) FROM "Offer" o LEFT JOIN "Engagement" e ON e."acceptedOfferId"=o.id WHERE o.status='ACCEPTED' AND e.id IS NULL)+
      (SELECT count(*) FROM "Engagement" e JOIN "Offer" o ON o.id=e."acceptedOfferId" WHERE o.status<>'ACCEPTED')+
      (SELECT count(*) FROM (SELECT "applicationId" FROM "Offer" WHERE status='PENDING' GROUP BY "applicationId" HAVING count(*)>1) x)+
      (SELECT count(*) FROM (SELECT "jobId","workerProfileId" FROM "Application" GROUP BY 1,2 HAVING count(*)>1) x)+
      (SELECT count(*) FROM "Review" r JOIN "Engagement" e ON e.id=r."engagementId" JOIN "Job" j ON j.id=e."jobId" WHERE e.status<>'COMPLETED' OR r."workerProfileId"<>e."workerProfileId" OR r."companyId" IS DISTINCT FROM j."companyId" OR (j."companyId" IS NULL AND r."employerProfileId" IS DISTINCT FROM j."employerProfileId"))+
      (SELECT count(*) FROM "Job" j LEFT JOIN "AuditEvent" a ON a.id=j."moderationAuditId" WHERE j."moderationAuditId" IS NOT NULL AND (a.id IS NULL OR a."resourceId"<>j.id OR a."resourceType"<>'JOB'))+
      (SELECT count(*) FROM "User" u LEFT JOIN "AuditEvent" a ON a.id=u."moderationAuditId" WHERE u."moderationAuditId" IS NOT NULL AND (a.id IS NULL OR a."resourceId"<>u.id OR a."resourceType"<>'USER'))+
      (SELECT count(*) FROM "Review" r LEFT JOIN "AuditEvent" a ON a.id=r."moderationAuditId" WHERE r."moderationAuditId" IS NOT NULL AND (a.id IS NULL OR a."resourceId"<>r.id OR a."resourceType"<>'REVIEW'))+
      (SELECT count(*) FROM "Engagement" e LEFT JOIN "AuditEvent" a ON a.id=e."moderationAuditId" WHERE e."moderationAuditId" IS NOT NULL AND (a.id IS NULL OR a."resourceId"<>e.id OR a."resourceType"<>'ENGAGEMENT'))
    )::bigint AS bad`;
    assert.equal(integrity.bad,0n);
    console.info("PASS: hardening actual PG rates/retries/deadlock/dual-role/status/quota/capacity/duplicates/rollback/cursors/plans/integrity.");
  } catch { console.error(`FAIL: hardening at ${stage}; sensitive diagnostics suppressed.`); process.exitCode=1; }
  finally {
    try {
      await cleanupModerationFixtures(db,users);
      const jobs={createdByUserId:{in:users}}, apps={job:jobs}, chats={job:jobs};
      await db.notification.deleteMany({where:{conversation:chats}}); await db.conversationReadState.deleteMany({where:{conversation:chats}}); await db.message.deleteMany({where:{conversation:chats}}); await db.conversation.deleteMany({where:chats});
      await db.review.deleteMany({where:{engagement:{job:jobs}}}); await db.engagement.deleteMany({where:{job:jobs}}); await db.offer.deleteMany({where:{application:apps}}); await db.application.deleteMany({where:apps});
      await db.jobSkill.deleteMany({where:{job:jobs}}); await db.jobScheduleWindow.deleteMany({where:{job:jobs}}); await db.job.deleteMany({where:jobs});
      await db.workerProfile.deleteMany({where:{userId:{in:users}}}); await db.employerProfile.deleteMany({where:{userId:{in:users}}}); await db.userRole.deleteMany({where:{userId:{in:users}}}); await db.user.deleteMany({where:{id:{in:users}}});
      await db.rateLimit.deleteMany({where:{OR:[{key:{in:extraRateKeys}},...users.flatMap(id=>[{key:`job-draft:user:${id}`},{key:`message:user:${id}`},{key:{startsWith:`message:conversation:${id}:`}}])]}});
    } catch {console.error("FAIL: hardening owned-fixture cleanup.");process.exitCode=1;}
    await db.$disconnect().catch(()=>{process.exitCode=1;});
  }
}
