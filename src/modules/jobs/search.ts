import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { parse } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { publicQuerySchema } from "./contracts";
import { jobSelect, publicJobDto } from "./projection";
import { visibleRecruitingSql, visibleRecruitingWhere } from "./moderation";

const cursorSchema = z.strictObject({ v: z.literal(1), scope: z.string().regex(/^[a-f0-9]{64}$/), rank: z.number().int().min(0), published: z.iso.datetime(), id: z.uuid() });
export async function publicSearchSkills(db: PrismaClient) {
  return db.skill.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 });
}
export async function searchPublicJobs(db: PrismaClient, raw: unknown) {
  const query = parse(publicQuerySchema, raw);
  const { cursor, limit, ...filters } = query;
  const scope = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  let after: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try { after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))); }
    catch { throw new AppError("VALIDATION"); }
    if (after.scope !== scope) throw new AppError("VALIDATION");
  }
  const conditions: Prisma.Sql[] = [Prisma.sql`j."status" = 'PUBLISHED'`, visibleRecruitingSql];
  if (query.q) conditions.push(Prisma.sql`j."searchVector" @@ plainto_tsquery('pg_catalog.simple'::regconfig, ${query.q})`);
  if (query.city) conditions.push(Prisma.sql`j."city" = ${query.city}`);
  if (query.employmentType) conditions.push(Prisma.sql`j."employmentType" = ${query.employmentType}::"EmploymentType"`);
  if (query.workMode) conditions.push(Prisma.sql`j."workMode" = ${query.workMode}::"WorkMode"`);
  if (query.category) conditions.push(Prisma.sql`j."category" = ${query.category}::"JobCategory"`);
  if (query.skillId) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "JobSkill" s WHERE s."jobId"=j."id" AND s."skillId"=${query.skillId})`);
  if (query.compensationType) conditions.push(Prisma.sql`j."compensationType" = ${query.compensationType}::"CompensationType"`);
  if (query.compensationMin) conditions.push(Prisma.sql`j."compensationMax" >= ${BigInt(query.compensationMin)}`);
  if (query.compensationMax) conditions.push(Prisma.sql`j."compensationMin" <= ${BigInt(query.compensationMax)}`);
  const rank = query.q ? Prisma.sql`round((ts_rank_cd(j."searchVector", plainto_tsquery('pg_catalog.simple'::regconfig, ${query.q})) * 1000000)::numeric)::integer` : Prisma.sql`0::integer`;
  const pageCondition = after ? Prisma.sql`WHERE (rank < ${after.rank} OR (rank = ${after.rank} AND ("publishedAt" < ${new Date(after.published)} OR ("publishedAt" = ${new Date(after.published)} AND id > ${after.id}))))` : Prisma.empty;
  // Only IDs/rank are read from FTS. The existing public projection remains the
  // sole field allowlist, and lifecycle visibility is rechecked on hydration.
  const hits = await db.$queryRaw<{ id: string; rank: number; publishedAt: Date }[]>(Prisma.sql`
    WITH hits AS (SELECT j."id", j."publishedAt", ${rank} AS rank FROM "Job" j WHERE ${Prisma.join(conditions, " AND ")})
    SELECT * FROM hits ${pageCondition} ORDER BY rank DESC, "publishedAt" DESC, id ASC LIMIT ${limit + 1}`);
  const page = hits.slice(0, limit);
  const rows = await db.job.findMany({ where: { AND: [{ id: { in: page.map((hit) => hit.id) }, status: "PUBLISHED" }, visibleRecruitingWhere] }, select: jobSelect });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const last = page.at(-1);
  return { items: page.flatMap((hit) => { const row = byId.get(hit.id); return row ? [publicJobDto(row)] : []; }),
    nextCursor: hits.length > limit && last ? Buffer.from(JSON.stringify({ v: 1, scope, rank: last.rank, published: last.publishedAt.toISOString(), id: last.id })).toString("base64url") : null };
}
