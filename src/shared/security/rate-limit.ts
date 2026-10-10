import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/shared/errors/app-error";

type RateDb = Pick<Prisma.TransactionClient, "$queryRaw">;
// One SQL statement serializes existing AND missing keys across instances. DB
// clock only. No pruning of other modules' longer-lived counters.
export async function consumeRate(db: RateDb, key: string, rule: { window: number; max: number }, sliding = false) {
  if (key.length > 512 || !Number.isInteger(rule.max) || rule.max < 1 || !Number.isInteger(rule.window) || rule.window < 1) throw new AppError("INTERNAL");
  const rows = await db.$queryRaw<{ count: number }[]>`WITH clock AS (
    SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now
  ) INSERT INTO "RateLimit" (id,key,count,"lastRequest") SELECT ${randomUUID()},${key},1,now FROM clock
  ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN (SELECT now FROM clock)-"RateLimit"."lastRequest">=${BigInt(rule.window * 1000)} THEN 1 ELSE "RateLimit".count+1 END,
    "lastRequest"=CASE WHEN ${sliding} OR (SELECT now FROM clock)-"RateLimit"."lastRequest">=${BigInt(rule.window * 1000)} THEN (SELECT now FROM clock) ELSE "RateLimit"."lastRequest" END
  WHERE "RateLimit".count<${rule.max} OR (SELECT now FROM clock)-"RateLimit"."lastRequest">=${BigInt(rule.window * 1000)} RETURNING count`;
  return { allowed: rows.length === 1, retryAfter: rows.length ? null : rule.window };
}
export async function requireRate(db: RateDb, key: string, rule: { window: number; max: number }) {
  if (!(await consumeRate(db, key, rule)).allowed) throw new AppError("RATE_LIMITED");
}
