import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());
// Operator-only, read-only verification. Never creates users or smoke fixtures.
const connectionString = process.env.DIRECT_DATABASE_URL;
if (!connectionString) {
  console.error("BLOCKED: DIRECT_DATABASE_URL is required for release verification.");
  process.exitCode = 2;
} else {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
  let stage = "connection";
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    stage = "PostgreSQL compatibility";
    const { rows: [server] } = await client.query<{ version: string; encoding: string; unicode: boolean }>(
      "SELECT current_setting('server_version_num') AS version, current_setting('server_encoding') AS encoding, EXISTS(SELECT 1 FROM pg_collation WHERE collname='pg_unicode_fast' AND collnamespace='pg_catalog'::regnamespace) AS unicode");
    if (!server || Number(server.version) < 180000 || server.encoding !== "UTF8" || !server.unicode) throw new Error("Compatibility");
    stage = "migration history";
    const folders = (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const { rows: migrations } = await client.query<{ migration_name: string; checksum: string; finished: boolean; rolled_back: boolean }>(
      'SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations"');
    for (const folder of folders) {
      const checksum = createHash("sha256").update(await readFile(`prisma/migrations/${folder}/migration.sql`)).digest("hex");
      const attempts = migrations.filter((row) => row.migration_name === folder);
      if (attempts.some((row) => !row.finished && !row.rolled_back) || !attempts.some((row) => row.finished && !row.rolled_back && row.checksum === checksum)) throw new Error("Migration");
    }
    if (migrations.some((row) => !folders.includes(row.migration_name))) throw new Error("Unknown migration");
    stage = "taxonomy and SQL-owned indexes";
    const { rows: [catalog] } = await client.query<{ skills: number; indexes: number; triggers: number }>(`
      SELECT (SELECT count(*)::int FROM "Skill" WHERE active AND slug IN ('data-entry','office-operations','excel','bookkeeping','content-writing','social-media','graphic-design','video-editing','event-support','shop-assistance')) AS skills,
      (SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indisvalid AND c.relnamespace='public'::regnamespace AND c.relname IN ('Job_published_search_gin','Job_visible_published','Offer_one_pending_per_application','Report_one_unresolved','Review_engagementId_direction_key')) AS indexes,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND t.tgenabled='O' AND t.tgname IN ('Audit_immutable','Audit_effect_required','Offer_immutable_history','Engagement_immutable_history','Application_match_snapshot_immutable','Message_immutable','Review_completed_insert','Review_immutable_history')) AS triggers`);
    if (!catalog || catalog.skills !== 10 || catalog.indexes !== 5 || catalog.triggers !== 8) throw new Error("Catalog");
    await client.query("COMMIT");
    console.info(`PASS: PostgreSQL 18+ UTF8, Unicode collation, ${folders.length} committed migration checksums, ten skills and required SQL indexes/history guards; read-only, no fixtures.`);
  } catch {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`FAIL: release database verification at ${stage}; connection and diagnostics suppressed.`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => { process.exitCode = 1; });
  }
}
