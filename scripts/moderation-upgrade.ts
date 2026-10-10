// Rehearse a populated Phase 8 → 9 upgrade inside a rollback-only isolated schema.
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { testDatabase } from "./test-database";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: upgrade rehearsal requires an explicit disposable PostgreSQL."); process.exitCode = 2;
} else {
  const { DATABASE_URL } = testDatabase(process.env);
  const client = new pg.Client({ connectionString: DATABASE_URL });
  const schema = `phase9_upgrade_${randomUUID().replaceAll("-", "")}`;
  let stage = "historical migrations";
  try {
    await client.connect(); await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    const migrations = (await readdir("prisma/migrations")).filter((name) => /^\d/.test(name)).sort();
    for (const name of migrations.filter((name) => name < "20261009090000")) await client.query(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
    stage = "populated historical fixtures";
    const [w, owner, wp, ep, job, app, offer, engagement, review, ownerReview, appNull, secondJob] = Array.from({ length: 12 }, () => randomUUID());
    await client.query(`INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,'Upgrade Worker',$1||'@example.invalid',true,now()),($2,'Upgrade Employer',$2||'@example.invalid',true,now())`, [w, owner]);
    await client.query(`INSERT INTO "UserRole" ("userId",role,"grantedBy") VALUES ($1,'WORKER','test-fixture'),($2,'EMPLOYER','test-fixture')`, [w, owner]);
    await client.query(`INSERT INTO "WorkerProfile" (id,"userId","updatedAt") VALUES ($1,$2,now())`, [wp, w]);
    await client.query(`INSERT INTO "EmployerProfile" (id,"userId","updatedAt") VALUES ($1,$2,now())`, [ep, owner]);
    for (const id of [job, secondJob]) await client.query(`INSERT INTO "Job" (id,"createdByUserId","employerProfileId","creationKey",title,status,"publishedAt","updatedAt") VALUES ($1,$2,$3,$1,'Legacy searchable work','PUBLISHED',now(),now())`, [id, owner, ep]);
    await client.query(`INSERT INTO "Application" (id,"jobId","workerProfileId","creationKey",status,"updatedAt","matchEligibleAtApply","matchScoreAtApply","matchCoverageAtApply","matchWeightsVersion","matchAlgorithmVersion","matchedAt") VALUES ($1,$2,$3,$1,'ACCEPTED',now(),true,75,60,'v1','deterministic-v1',now())`, [app, job, wp]);
    await client.query(`INSERT INTO "Application" (id,"jobId","workerProfileId","creationKey","updatedAt") VALUES ($1,$2,$3,$1,now())`, [appNull, secondJob, wp]);
    const terms = { schemaVersion: 1, fixture: "immutable historical terms" };
    await client.query(`INSERT INTO "Offer" (id,"applicationId","jobId","creationKey",revision,status,terms,"resolvedAt") VALUES ($1,$2,$3,$1,1,'ACCEPTED',$4,now())`, [offer, app, job, terms]);
    await client.query(`INSERT INTO "Engagement" (id,"applicationId","acceptedOfferId","jobId","workerProfileId",terms,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`, [engagement, app, offer, job, wp, { schemaVersion: 1, offer: terms }]);
    await client.query(`UPDATE "Engagement" SET status='COMPLETED',"startedAt"=now(),"completionRequestedAt"=now(),"completedAt"=now() WHERE id=$1`, [engagement]);
    for (const [id, direction, reviewer] of [[review, "WORKER_TO_EMPLOYER", w], [ownerReview, "EMPLOYER_TO_WORKER", owner]]) await client.query(`INSERT INTO "Review" (id,"engagementId",direction,"reviewerUserId","workerProfileId","employerProfileId",rating,comment,"creationKey") VALUES ($1,$2,$3,$4,$5,$6,4,'Preserve legacy content',$1)`, [id, engagement, direction, reviewer, wp, ep]);
    // A trusted legacy hidden fixture; application APIs never expose this writer.
    await client.query(`ALTER TABLE "Review" DISABLE TRIGGER "Review_immutable_history"`);
    await client.query(`UPDATE "Review" SET "hiddenAt"=now() WHERE id=$1`, [ownerReview]);
    await client.query(`ALTER TABLE "Review" ENABLE TRIGGER "Review_immutable_history"`);
    async function snapshot() {
      const result: Record<string, unknown> = {};
      for (const table of ["User", "Job", "Application", "Offer", "Engagement", "Review"]) result[table] = (await client.query(`SELECT to_jsonb(t)-'moderationAuditId'-'moderationHiddenAt' AS row FROM "${table}" t ORDER BY id`)).rows;
      return result;
    }
    const before = await snapshot(); stage = "Phase 9 migration and preservation";
    await client.query(await readFile("prisma/migrations/20261009090000_moderation/migration.sql", "utf8"));
    assert.deepEqual(await snapshot(), before);
    const indexes = (await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='Job_published_search_gin'`, [schema])).rows;
    assert.match(indexes[0].indexdef, /moderationHiddenAt/);
    await client.query("SAVEPOINT immutable_check");
    await assert.rejects(() => client.query(`UPDATE "Review" SET rating=1 WHERE id=$1`, [review]));
    await client.query("ROLLBACK TO SAVEPOINT immutable_check");
    console.log("PASS: populated Phase 8→9 upgrade preserves visible/hidden reviews, immutable work terms, v1/null Application snapshots and SQL-owned FTS; rehearsal rolled back.");
  } catch { console.error(`FAIL: moderation upgrade rehearsal at ${stage}.`); process.exitCode = 1; }
  finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
}
