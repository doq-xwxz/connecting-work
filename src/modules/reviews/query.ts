import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { emptyFacts, type ReputationFacts } from "./contracts";

// Public, transaction-scoped reputation query. One batched indexed statement,
// irrespective of pool size; matching consumes facts, never Review UI/repositories.
export async function getWorkerReputationFacts(tx: Prisma.TransactionClient, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length > 200) throw new Error("Reputation batch exceeds bound");
  const result = new Map(unique.map((id) => [id, emptyFacts()]));
  if (!unique.length) return result;
  // Both aggregates share one PostgreSQL statement snapshot, including concurrent
  // review/hiring commits. No rounded UI average enters the scorer.
  const history = await tx.$queryRaw<{ id: string; completed: bigint; cancelled: bigint; ratingSum: bigint; ratingCount: bigint }[]>(Prisma.sql`
    WITH ratings AS (
      SELECT r."workerProfileId" AS id, sum(r.rating)::bigint AS sum, count(*) AS count
      FROM "Review" r JOIN "Engagement" e ON e.id=r."engagementId"
      WHERE r."workerProfileId" IN (${Prisma.join(unique)}) AND r.direction='EMPLOYER_TO_WORKER'
        AND r."hiddenAt" IS NULL AND e.status='COMPLETED' GROUP BY r."workerProfileId"
    ), history AS (SELECT e."workerProfileId" AS id,
      count(*) FILTER (WHERE e."status" = 'COMPLETED') AS completed,
      count(*) FILTER (WHERE e."status" = 'CANCELLED' AND e."cancelledBy" = w."userId") AS cancelled
    FROM "Engagement" e JOIN "WorkerProfile" w ON w."id" = e."workerProfileId"
    WHERE e."workerProfileId" IN (${Prisma.join(unique)}) AND e."status" IN ('COMPLETED','CANCELLED') GROUP BY e."workerProfileId")
    SELECT w.id, coalesce(h.completed,0)::bigint AS completed, coalesce(h.cancelled,0)::bigint AS cancelled,
      coalesce(r.sum,0)::bigint AS "ratingSum", coalesce(r.count,0)::bigint AS "ratingCount"
    FROM "WorkerProfile" w LEFT JOIN ratings r ON r.id=w.id LEFT JOIN history h ON h.id=w.id WHERE w.id IN (${Prisma.join(unique)})`);
  for (const row of history) Object.assign(result.get(row.id)!, { completed: Number(row.completed), relevantCancelled: Number(row.cancelled), ratingSum: Number(row.ratingSum), ratingCount: Number(row.ratingCount) });
  return result;
}
export async function getOwnerReputationFacts(tx: Prisma.TransactionClient, owner: { companyId: string | null; employerProfileId: string }): Promise<ReputationFacts> {
  const where = owner.companyId ? { companyId: owner.companyId } : { companyId: null, employerProfileId: owner.employerProfileId };
  const rating = await tx.review.aggregate({ where: { ...where, direction: "WORKER_TO_EMPLOYER", hiddenAt: null, engagement: { status: "COMPLETED" } }, _sum: { rating: true }, _count: true });
  const history = await tx.engagement.groupBy({ by: ["status"], where: { job: where, status: { in: ["COMPLETED", "CANCELLED"] } }, _count: true });
  // Cancellation reasons/actors stay private. Employer causation cannot be
  // reconstructed reliably for departed Company members; expose completion only.
  return { ratingSum: rating._sum.rating ?? 0, ratingCount: rating._count,
    completed: history.find((row) => row.status === "COMPLETED")?._count ?? 0, relevantCancelled: 0 };
}
