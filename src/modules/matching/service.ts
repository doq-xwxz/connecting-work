import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { requireEmployerProfile, requireWorkerProfile } from "@/modules/profiles/access";
import { discoveryWorkerDto, selfWorkerDto, workerSelect } from "@/modules/profiles/service";
import { levels, opaqueId, pageSchema, parse } from "@/modules/profiles/contracts";
import { inputFromRow, jobSelect, publicJobDto } from "@/modules/jobs/projection";
import { managedRow } from "@/modules/jobs/service";
import { AppError } from "@/shared/errors/app-error";
import { matchingConfig, matchWorkerJob, type MatchResult } from "./algorithm";
import { getWorkerReputationFacts } from "@/modules/reviews/query";
import { reputationDto } from "@/modules/reviews/contracts";
import { requireRecruitingVisible, visibleRecruitingWhere } from "@/modules/jobs/moderation";

export const CANDIDATE_POOL_LIMIT = 200;
const querySchema = pageSchema.extend({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,600}$/).optional() });
const cursorSchema = z.strictObject({ v: z.literal(1), scope: z.string().regex(/^[a-f0-9]{64}$/), score: z.number().int().min(0).max(100), coverage: z.number().int().min(0).max(100), id: opaqueId });
function rankPage<T extends { id: string; match: MatchResult }>(rows: T[], raw: unknown, context: string) {
  const query = parse(querySchema, raw), scope = createHash("sha256").update(context).digest("hex");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); } catch { throw new AppError("VALIDATION"); }
    if (cursor.scope !== scope) throw new AppError("VALIDATION");
  }
  const sorted = rows.filter((row) => row.match.eligible && row.match.score !== null)
    .sort((a, b) => b.match.score! - a.match.score! || b.match.coverage - a.match.coverage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const remaining = cursor ? sorted.filter((row) => row.match.score! < cursor.score || (row.match.score === cursor.score && (row.match.coverage < cursor.coverage || (row.match.coverage === cursor.coverage && row.id > cursor.id)))) : sorted;
  const items = remaining.slice(0, query.limit), last = items.at(-1);
  return { items, candidatePoolLimit: CANDIDATE_POOL_LIMIT, rankingScope: "BOUNDED_POOL" as const,
    nextCursor: remaining.length > query.limit && last ? Buffer.from(JSON.stringify({ v: 1, scope, score: last.match.score, coverage: last.match.coverage, id: last.id })).toString("base64url") : null };
}
export async function recommendedJobs(db: PrismaClient, actor: Principal, raw: unknown) {
  parse(querySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "WORKER", true);
    const own = await requireWorkerProfile(tx, actor.id);
    const worker = selfWorkerDto(await tx.workerProfile.findUniqueOrThrow({ where: { id: own.id }, select: workerSelect }));
    const rows = await tx.job.findMany({ where: { AND: [visibleRecruitingWhere], status: "PUBLISHED", applications: { none: { workerProfileId: own.id } },
      skills: { none: { required: true, NOT: { OR: worker.skills.map((skill) => ({ skillId: skill.skillId, minimumLevel: { in: levels.slice(0, levels.indexOf(skill.level) + 1) } })) } } },
      NOT: [{ companyId: null, employer: { userId: actor.id } }, { company: { members: { some: { userId: actor.id } } } }] },
      select: jobSelect, orderBy: { id: "asc" }, take: CANDIDATE_POOL_LIMIT });
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    const offsetCache = new Map<string, number | null>();
    const facts = (await getWorkerReputationFacts(tx, [own.id])).get(own.id)!;
    const data = rows.map((row) => ({ ...publicJobDto(row), match: matchWorkerJob(worker, worker.displayName, inputFromRow(row), row.status, clock.now, offsetCache, facts) }));
    return { ...rankPage(data, raw, `worker:${own.id}:${matchingConfig.weightsVersion}:${matchingConfig.algorithmVersion}`), profileCompleteness: worker.completeness };
  }, { timeout: 15000 });
}
export async function recommendedCandidates(db: PrismaClient, actor: Principal, jobId: string, raw: unknown) {
  parse(opaqueId, jobId); parse(querySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    const profile = await requireEmployerProfile(tx, actor.id);
    // Membership revocation takes this same Company lock. This private read cannot
    // continue on creator provenance after a concurrent removal commits.
    const job = await managedRow(tx, actor, profile.id, jobId, true);
    await requireRecruitingVisible(tx, jobId);
    if (!["PUBLISHED", "PAUSED"].includes(job.status)) throw new AppError("CONFLICT");
    const rows = await tx.workerProfile.findMany({ where: { discoverable: true,
      AND: job.skills.filter((skill) => skill.required).map((skill) => ({ skills: { some: { skillId: skill.skillId, level: { in: levels.slice(levels.indexOf(skill.minimumLevel)) }, skill: { active: true } } } })),
      user: { status: "ACTIVE", roles: { some: { role: "WORKER" } },
        ...(job.companyId ? { companyMemberships: { none: { companyId: job.companyId } } } : { id: { not: actor.id } }) } },
      select: workerSelect, orderBy: { id: "asc" }, take: CANDIDATE_POOL_LIMIT });
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    const offsetCache = new Map<string, number | null>();
    const terms = inputFromRow(job);
    const facts = await getWorkerReputationFacts(tx, rows.map((row) => row.id));
    const data = rows.map((row) => {
      const worker = selfWorkerDto(row);
      return { ...discoveryWorkerDto(row), profileCompleteness: worker.completeness,
        reputation: reputationDto(facts.get(row.id)!), match: matchWorkerJob(worker, row.user.name, terms, job.status, clock.now, offsetCache, facts.get(row.id)) };
    });
    return rankPage(data, raw, `employer:${actor.id}:${job.id}:${matchingConfig.weightsVersion}:${matchingConfig.algorithmVersion}`);
  }, { timeout: 15000 });
}
