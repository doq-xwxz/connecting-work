import { z } from "zod";
import { moneySchema, jobSchema, termShape } from "@/modules/jobs/contracts";
import { opaqueId, pageSchema } from "@/modules/profiles/contracts";

export const applicationStatuses = ["APPLIED", "VIEWED", "SHORTLISTED", "OFFERED", "ACCEPTED", "REJECTED", "WITHDRAWN", "CANCELLED"] as const;
export const offerStatuses = ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"] as const;
export const engagementStatuses = ["ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const applicationActions = ["view", "shortlist", "reject", "withdraw"] as const;
export const offerActions = ["accept", "decline", "revoke"] as const;
export const engagementActions = ["start", "request-completion", "confirm-completion", "cancel"] as const;
export const emptySchema = z.strictObject({});
export const applySchema = z.strictObject({ creationKey: opaqueId });
export const offerSchema = z.strictObject({ creationKey: opaqueId, expiresAt: z.iso.datetime().nullable(),
  compensationMin: moneySchema.optional(), compensationMax: moneySchema.optional() })
  .refine((input) => (input.compensationMin === undefined) === (input.compensationMax === undefined))
  .refine((input) => input.compensationMin === undefined || (moneySchema.safeParse(input.compensationMin).success && moneySchema.safeParse(input.compensationMax).success && BigInt(input.compensationMin) <= BigInt(input.compensationMax!)));
export const cancellationSchema = z.strictObject({ category: z.enum(["PERSONAL", "SCHEDULE", "TERMS", "OTHER"]), reason: z.string().trim().min(1).max(500) });
export const hiringQuerySchema = pageSchema.extend({ cursor: opaqueId.optional(), status: z.enum(applicationStatuses).optional() });
export const ownerSchema = z.strictObject({ kind: z.enum(["PERSONAL", "COMPANY"]), displayName: z.string().max(200),
  companySlug: z.string().nullable(), verification: z.enum(["UNVERIFIED", "VERIFIED"]).nullable() });
export const snapshotSchema = z.strictObject({ schemaVersion: z.literal(1), jobId: opaqueId, jobVersion: z.number().int().positive(),
  ownerId: opaqueId, owner: ownerSchema, job: z.strictObject(termShape).refine((input) => jobSchema.safeParse(input).success),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime().nullable() });
export const acceptedSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), offer: snapshotSchema,
  worker: z.strictObject({ displayName: z.string().max(200), headline: z.string().max(160) }), acceptedAt: z.iso.datetime() });
export type OfferSnapshot = z.infer<typeof snapshotSchema>;
export type AcceptedSnapshot = z.infer<typeof acceptedSnapshotSchema>;
export type ApplicationAction = typeof applicationActions[number];
export type OfferAction = typeof offerActions[number];
export type EngagementAction = typeof engagementActions[number];
