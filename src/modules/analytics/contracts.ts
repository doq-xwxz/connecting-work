import { z } from "zod";

const instant = z.iso.datetime({ offset: false }).transform((value) => new Date(value));
export const rangeSchema = z.strictObject({ start: instant, end: instant }).refine(
  ({ start, end }) => end > start && end.getTime() - start.getTime() <= 366 * 86400000,
  { path: ["end"], message: "Invalid range" },
);
export function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, percent: denominator === 0 ? null : Math.round(numerator * 1000 / denominator) / 10 };
}
export function defaultRange(now = new Date()) {
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  return { start: new Date(end.getTime() - 30 * 86400000).toISOString(), end: end.toISOString() };
}
