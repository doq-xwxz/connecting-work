import type { Prisma } from "@/generated/prisma/client";
import { acceptedSnapshotSchema, snapshotSchema } from "./contracts";

export const offerSelect = { id: true, revision: true, status: true, terms: true, createdAt: true, expiresAt: true, resolvedAt: true } satisfies Prisma.OfferSelect;
export const engagementSelect = { id: true, status: true, terms: true, acceptedAt: true, startedAt: true, completionRequestedAt: true,
  completedAt: true, cancelledAt: true, cancellationCategory: true, cancellationReason: true } satisfies Prisma.EngagementSelect;
export const applicationSelect = { id: true, status: true, appliedAt: true, updatedAt: true, viewedAt: true, shortlistedAt: true,
  offeredAt: true, acceptedAt: true, rejectedAt: true, withdrawnAt: true, cancelledAt: true,
  matchEligibleAtApply: true, matchScoreAtApply: true, matchCoverageAtApply: true, matchWeightsVersion: true, matchAlgorithmVersion: true, matchedAt: true,
  job: { select: { id: true, title: true, status: true } },
  offers: { select: offerSelect, orderBy: { revision: "desc" }, take: 1 }, engagement: { select: engagementSelect },
} satisfies Prisma.ApplicationSelect;
const iso = (date: Date | null) => date?.toISOString() ?? null;
export function offerDto(row: Prisma.OfferGetPayload<{ select: typeof offerSelect }>) {
  const terms = snapshotSchema.parse(row.terms);
  return { id: row.id, revision: row.revision, status: row.status, createdAt: row.createdAt.toISOString(), expiresAt: iso(row.expiresAt), resolvedAt: iso(row.resolvedAt),
    terms: { schemaVersion: terms.schemaVersion, jobId: terms.jobId, jobVersion: terms.jobVersion, job: terms.job, owner: terms.owner, createdAt: terms.createdAt, expiresAt: terms.expiresAt } };
}
export function engagementDto(row: Prisma.EngagementGetPayload<{ select: typeof engagementSelect }>) {
  const terms = acceptedSnapshotSchema.parse(row.terms);
  return { id: row.id, status: row.status, acceptedAt: row.acceptedAt.toISOString(), startedAt: iso(row.startedAt), completionRequestedAt: iso(row.completionRequestedAt),
    completedAt: iso(row.completedAt), cancelledAt: iso(row.cancelledAt), cancellationCategory: row.cancellationCategory, cancellationReason: row.cancellationReason,
    terms: { schemaVersion: terms.schemaVersion, acceptedAt: terms.acceptedAt, worker: terms.worker, job: terms.offer.job, owner: terms.offer.owner } };
}
export function applicationDto(row: Prisma.ApplicationGetPayload<{ select: typeof applicationSelect }>) {
  return { id: row.id, status: row.status, job: { id: row.job.id, title: row.job.title, status: row.job.status },
    matchAtApply: row.matchedAt ? { eligible: row.matchEligibleAtApply, score: row.matchScoreAtApply, coverage: row.matchCoverageAtApply,
      weightsVersion: row.matchWeightsVersion, algorithmVersion: row.matchAlgorithmVersion, matchedAt: row.matchedAt.toISOString() } : null,
    appliedAt: row.appliedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), viewedAt: iso(row.viewedAt), shortlistedAt: iso(row.shortlistedAt),
    offeredAt: iso(row.offeredAt), acceptedAt: iso(row.acceptedAt), rejectedAt: iso(row.rejectedAt), withdrawnAt: iso(row.withdrawnAt), cancelledAt: iso(row.cancelledAt),
    offer: row.offers[0] ? offerDto(row.offers[0]) : null, engagement: row.engagement ? engagementDto(row.engagement) : null };
}
export type HiringApplication = ReturnType<typeof applicationDto>;
