import { describe, expect, it } from "vitest";
import { reviewSchema, reviewQuerySchema, reputationDto, emptyFacts } from "./contracts";
const key = "11111111-1111-4111-8111-111111111111";
describe("immutable review input and exact reputation presentation", () => {
  it.each([0, 6, 2.5, "5", null])("rejects uncontrolled rating %s", (rating) => expect(reviewSchema.safeParse({ rating, comment: null, creationKey: key }).success).toBe(false));
  it.each(["\u200b", "\u0000", "\ud800", "a".repeat(2001)])("rejects invalid text", (comment) => expect(reviewSchema.safeParse({ rating: 5, comment, creationKey: key }).success).toBe(false));
  it("normalizes optional plain text and rejects ownership injection", () => {
    expect(reviewSchema.parse({ rating: 5, comment: "  <script>x</script>\r\nline  ", creationKey: key }).comment).toBe("<script>x</script>\nline");
    expect(reviewSchema.parse({ rating: 1, comment: "  ", creationKey: key }).comment).toBeNull();
    expect(reviewSchema.safeParse({ rating: 5, comment: null, creationKey: key, reviewerUserId: key }).success).toBe(false);
    expect(reviewQuerySchema.safeParse({ limit: 31 }).success).toBe(false);
  });
  it("keeps no-data distinct and rounds rating once half-up", () => {
    expect(reputationDto(emptyFacts())).toMatchObject({ version: "reputation-v1", rating: { average: null, count: 0 }, reliability: { score: null, sampleSize: 0 } });
    expect(reputationDto({ ratingSum: 17, ratingCount: 4, completed: 2, relevantCancelled: 1 })).toMatchObject({ rating: { average: 4.3, count: 4 }, reliability: { score: 0.6667, sampleSize: 3 } });
  });
});
