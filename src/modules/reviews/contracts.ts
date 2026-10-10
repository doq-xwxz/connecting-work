import { z } from "zod";
import { opaqueId } from "@/modules/profiles/contracts";
import { validPlainText } from "@/shared/validation/text";

export const reviewSchema = z.strictObject({ rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).transform((text) => text.replace(/\r\n?/g, "\n").trim())
    .refine(validPlainText).transform((text) => text || null).nullable(),
  creationKey: opaqueId });
export const reviewQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(30).default(20), cursor: opaqueId.optional() });
export type ReputationFacts = { ratingSum: number; ratingCount: number; completed: number; relevantCancelled: number };
export const emptyFacts = (): ReputationFacts => ({ ratingSum: 0, ratingCount: 0, completed: 0, relevantCancelled: 0 });
export function reputationDto(facts: ReputationFacts) {
  const sampleSize = facts.completed + facts.relevantCancelled;
  // Positive integer half-up rounding, once at the presentation boundary.
  const scaled = (n: number, d: number, scale: number) => Number((BigInt(n) * BigInt(scale) * 2n + BigInt(d)) / (2n * BigInt(d)));
  return { version: "reputation-v1" as const, rating: { average: facts.ratingCount ? scaled(facts.ratingSum, facts.ratingCount, 10) / 10 : null, count: facts.ratingCount },
    reliability: { score: sampleSize ? scaled(facts.completed, sampleSize, 10000) / 10000 : null,
      completed: facts.completed, relevantCancelled: facts.relevantCancelled, sampleSize } };
}
