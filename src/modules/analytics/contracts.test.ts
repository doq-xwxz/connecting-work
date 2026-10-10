import { expect, it } from "vitest";
import { defaultRange, rangeSchema, ratio } from "./contracts";
it("accepts bounded UTC instants, rejects extra targets, invalid/reversed/oversized ranges", () => {
  const range = defaultRange(new Date("2026-10-10T00:00:00Z"));
  expect(rangeSchema.safeParse(range).success).toBe(true);
  for (const input of [{ ...range, userId: "private" }, { ...range, end: range.start }, { ...range, start: "2020-01-01T00:00:00Z" }, { ...range, start: "2026-09-01" }, { ...range, end: "2026-10-11T01:00:00+01:00" }]) expect(rangeSchema.safeParse(input).success).toBe(false);
});
it("preserves integer ratio evidence and treats zero as no data", () => {
  expect(ratio(0, 0)).toEqual({ numerator: 0, denominator: 0, percent: null });
  expect(ratio(1, 3).percent).toBe(33.3);
  expect(ratio(3, 3).percent).toBe(100);
});
