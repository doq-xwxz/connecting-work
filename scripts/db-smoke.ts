import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/shared/db/client";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("BLOCKED: DATABASE_URL is not configured. Provide a disposable PostgreSQL database and apply migrations. No credentials were printed.");
    process.exitCode = 2;
    return;
  }

  let db: ReturnType<typeof getDb> | undefined;
  const rollback = new Error("auth-smoke-rollback");
  try {
    db = getDb();
    await db.$queryRaw`SELECT 1`;
    try {
      await db.$transaction(async (tx) => {
        const id = randomUUID();
        const row = await tx.user.create({ data: { id, name: "Database smoke", email: `smoke-${id}@example.invalid` } });
        const found = await tx.user.findUnique({ where: { id: row.id }, include: { roles: true } });
        if (!found || found.status !== "ACTIVE" || found.emailVerified || found.roles.length) throw new Error("probe invalid");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    console.info("PASS: PostgreSQL connection and Prisma migration-backed CRUD verified; probe transaction rolled back.");
  } catch {
    console.error("FAIL: Database smoke failed. Check PostgreSQL availability, DATABASE_URL, TLS settings and applied migrations. Internal details/credentials suppressed.");
    process.exitCode = 1;
  } finally {
    try { await db?.$disconnect(); }
    catch {
      console.error("FAIL: Database disconnect failed. Internal details/credentials suppressed.");
      process.exitCode = 1;
    }
  }
}

await main();
