import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { parse } from "@/modules/profiles/contracts";
import { relevanceThresholds } from "@/modules/matching/algorithm";
import { rangeSchema, ratio } from "./contracts";

// Cross-domain, read-only aggregate boundary. No entity rows leave this module.
export async function adminAnalytics(db: PrismaClient, actor: Principal, raw: unknown) {
  const { start, end } = parse(rangeSchema, raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await currentActor(tx, actor, "ADMIN", true);
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT transaction_timestamp() AT TIME ZONE 'UTC' AS now`;
    const [facts] = await tx.$queryRaw<{
      publishedJobs: bigint; eligibleJobs: bigint; liquidJobs: bigint; excludedJobs: bigint;
      completedTotal: bigint; completedForced: bigint; applications: bigint; acceptedOffers: bigint; engagementsCreated: bigint;
      cohortApplications: bigint; shortlisted: bigint; offered: bigint; accepted: bigint; started: bigint; completed: bigint; cancelled: bigint; cohortCompletedForced: bigint; cohortCancelledForced: bigint;
    }[]>`
      WITH published AS (
        SELECT j.id, j."publishedAt", j."cancelledAt"
        FROM "Job" j WHERE j."publishedAt" >= ${start} AND j."publishedAt" < ${end} AND j."publishedAt" <= ${clock.now}
      ), observed AS (
        SELECT p.*, (
          p."cancelledAt" BETWEEN p."publishedAt" AND p."publishedAt" + interval '5 minutes'
          AND NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."jobId" = p.id)
        ) AS excluded,
        (SELECT count(*) FROM "Application" a WHERE a."jobId" = p.id
          AND a."appliedAt" >= p."publishedAt" AND a."appliedAt" <= p."publishedAt" + interval '24 hours'
          AND a."appliedAt" <= ${clock.now} AND a."matchEligibleAtApply" = true
          AND a."matchScoreAtApply" >= ${relevanceThresholds.score} AND a."matchCoverageAtApply" >= ${relevanceThresholds.coverage}) AS relevant
        FROM published p WHERE p."publishedAt" + interval '24 hours' <= ${clock.now}
      ), cohort AS (
        SELECT a.id, a."shortlistedAt", EXISTS (SELECT 1 FROM "Offer" o WHERE o."applicationId" = a.id AND o."createdAt" <= ${clock.now}) AS offered,
          e.id AS engagement, e."startedAt", e.status, au.action AS "moderationAction"
        FROM "Application" a LEFT JOIN "Engagement" e ON e."applicationId" = a.id
        LEFT JOIN "AuditEvent" au ON au.id = e."moderationAuditId" AND au."resourceType" = 'ENGAGEMENT' AND au."resourceId" = e.id
        WHERE a."appliedAt" >= ${start} AND a."appliedAt" < ${end} AND a."appliedAt" <= ${clock.now}
      ), completions AS (
        SELECT e.id, EXISTS (SELECT 1 FROM "AuditEvent" au WHERE au.id = e."moderationAuditId"
          AND au."resourceType" = 'ENGAGEMENT' AND au."resourceId" = e.id AND au.action = 'ENGAGEMENT_FORCE_COMPLETED') AS forced
        FROM "Engagement" e WHERE e.status = 'COMPLETED' AND e."completedAt" >= ${start} AND e."completedAt" < ${end} AND e."completedAt" <= ${clock.now}
      ) SELECT
        (SELECT count(*) FROM published) AS "publishedJobs",
        (SELECT count(*) FROM observed WHERE NOT coalesce(excluded,false)) AS "eligibleJobs",
        (SELECT count(*) FROM observed WHERE NOT coalesce(excluded,false) AND relevant >= 3) AS "liquidJobs",
        (SELECT count(*) FROM observed WHERE excluded) AS "excludedJobs",
        (SELECT count(*) FROM completions) AS "completedTotal",
        (SELECT count(*) FROM completions WHERE forced) AS "completedForced",
        (SELECT count(*) FROM cohort) AS applications,
        (SELECT count(*) FROM "Offer" WHERE status = 'ACCEPTED' AND "resolvedAt" >= ${start} AND "resolvedAt" < ${end} AND "resolvedAt" <= ${clock.now}) AS "acceptedOffers",
        (SELECT count(*) FROM "Engagement" WHERE "acceptedAt" >= ${start} AND "acceptedAt" < ${end} AND "acceptedAt" <= ${clock.now}) AS "engagementsCreated",
        (SELECT count(*) FROM cohort) AS "cohortApplications",
        (SELECT count(*) FROM cohort WHERE "shortlistedAt" IS NOT NULL) AS shortlisted,
        (SELECT count(*) FROM cohort WHERE offered) AS offered,
        (SELECT count(*) FROM cohort WHERE engagement IS NOT NULL) AS accepted,
        (SELECT count(*) FROM cohort WHERE "startedAt" IS NOT NULL) AS started,
        (SELECT count(*) FROM cohort WHERE status = 'COMPLETED') AS completed,
        (SELECT count(*) FROM cohort WHERE status = 'CANCELLED') AS cancelled,
        (SELECT count(*) FROM cohort WHERE status = 'COMPLETED' AND "moderationAction" = 'ENGAGEMENT_FORCE_COMPLETED') AS "cohortCompletedForced",
        (SELECT count(*) FROM cohort WHERE status = 'CANCELLED' AND "moderationAction" = 'ENGAGEMENT_FORCE_CANCELLED') AS "cohortCancelledForced"`;
    const f = Object.fromEntries(Object.entries(facts).map(([key, value]) => {
      const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error("Aggregate overflow"); return [key, n];
    })) as Record<keyof typeof facts, number>;
    return { definitionVersion: "marketplace-metrics-v1", range: { start: start.toISOString(), end: end.toISOString(), endExclusive: true }, asOf: clock.now.toISOString(),
      activity: { completedTotal: f.completedTotal, completedOrganic: f.completedTotal - f.completedForced, completedForced: f.completedForced,
        applications: f.applications, acceptedOffers: f.acceptedOffers, engagementsCreated: f.engagementsCreated, publishedJobs: f.publishedJobs },
      liquidity: { jobsEligibleFor24hLiquidity: f.eligibleJobs, jobsWith3RelevantApplicants24h: f.liquidJobs, excludedEarlyCancelledJobs: f.excludedJobs,
        rate: ratio(f.liquidJobs, f.eligibleJobs), targetPercent: 50 },
      applicationCohort: { applications: f.cohortApplications, shortlisted: f.shortlisted, offered: f.offered, accepted: f.accepted,
        started: f.started, completed: f.completed, completedOrganic: f.completed - f.cohortCompletedForced, completedForced: f.cohortCompletedForced,
        cancelled: f.cancelled, cancelledParticipant: f.cancelled - f.cohortCancelledForced, cancelledForced: f.cohortCancelledForced,
        shortlistRate: ratio(f.shortlisted, f.cohortApplications), offerRate: ratio(f.offered, f.cohortApplications),
        acceptanceRate: ratio(f.accepted, f.offered), startRate: ratio(f.started, f.accepted), completionRate: ratio(f.completed, f.completed + f.cancelled) } };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 });
}
