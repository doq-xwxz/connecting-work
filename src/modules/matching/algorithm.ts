import type { JobInput } from "@/modules/jobs/contracts";
import type { ReputationFacts } from "@/modules/reviews/contracts";
import { completeness, levels, type WorkerInput } from "@/modules/profiles/contracts";

export const matchingConfig = Object.freeze({ weightsVersion: "v1", algorithmVersion: "deterministic-v2",
  weights: Object.freeze({ skills: 35, availability: 20, location: 15, compensation: 10, experience: 10, rating: 5, reliability: 5 }) });
type ComponentKey = keyof typeof matchingConfig.weights;
type Fraction = { n: bigint; d: bigint };
const fraction = (n: number, d = 1): Fraction => ({ n: BigInt(n), d: BigInt(d) });
const add = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const round = (a: Fraction, scale = 1) => Number((a.n * BigInt(scale) * 2n + a.d) / (2n * a.d));
type Window = WorkerInput["availability"][number];
const weekMinutes = 10080;
function offset(formatter: Intl.DateTimeFormat, instant: Date) {
  const parts = formatter.formatToParts(instant);
  const value = parts.find((part) => part.type === "timeZoneName")!.value;
  if (value === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
}
function stableOffset(zone: string, reference: Date, cache: Map<string, number | null>) {
  // Reference Sunday UTC. Check every hour, including DST transitions.
  const start = new Date(reference); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const key = `${zone}:${start.toISOString()}`;
  if (cache.has(key)) return cache.get(key)!;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
  const first = offset(formatter, start);
  for (let hour = 1; hour <= 168; hour++) if (offset(formatter, new Date(start.getTime() + hour * 3600000)) !== first) { cache.set(key, null); return null; }
  cache.set(key, first); return first;
}
function minutes(windows: Window[], shift: number) {
  const result = new Set<number>();
  for (const window of windows) for (let minute = window.weekday * 1440 + window.startHour * 60; minute < window.weekday * 1440 + window.endHour * 60; minute++)
    result.add(((minute - shift) % weekMinutes + weekMinutes) % weekMinutes);
  return result;
}
function availability(worker: WorkerInput, job: JobInput, now: Date, cache: Map<string, number | null>): { value: Fraction | null; explanation: string } {
  if (!worker.availability.length || !job.schedule.length) return { value: null, explanation: "AVAILABILITY_NOT_SUPPLIED" };
  // Identical zones compare recurring local windows directly. Different zones use a
  // declared reference week; a DST transition is explicitly unmeasurable in V1.
  const reference = job.startDate ? new Date(`${job.startDate}T12:00:00Z`) : now;
  const workerOffset = worker.timezone === job.timezone ? 0 : stableOffset(worker.timezone, reference, cache);
  const jobOffset = worker.timezone === job.timezone ? 0 : stableOffset(job.timezone, reference, cache);
  if (workerOffset === null || jobOffset === null) return { value: null, explanation: "TIMEZONE_TRANSITION_UNCOVERED" };
  const supplied = minutes(worker.availability, workerOffset), requested = minutes(job.schedule, jobOffset);
  return { value: fraction([...requested].filter((minute) => supplied.has(minute)).length, requested.size), explanation: "RECURRING_OVERLAP_REFERENCE_WEEK" };
}
export type MatchResult = {
  eligible: boolean; reasons: string[]; score: number | null; coverage: number;
  components: { key: ComponentKey; weight: number; covered: boolean; score: number | null; weightedContribution: number | null; explanation: string }[];
  weightsVersion: string; algorithmVersion: string; computedAt: string;
};
export function matchWorkerJob(worker: WorkerInput, name: string, job: JobInput, status: string, computedAt: Date, offsetCache = new Map<string, number | null>(), reputation?: ReputationFacts): MatchResult {
  const reasons: string[] = [];
  if (!["PUBLISHED", "PAUSED"].includes(status)) reasons.push("JOB_NOT_MATCHABLE");
  if (!name.trim() || !completeness(worker).complete || (["PART_TIME", "TEMPORARY", "SHIFT"].includes(job.employmentType ?? "") && !worker.availability.length)) reasons.push("WORKER_PROFILE_INCOMPLETE");
  let skillSum = fraction(0), skillWeight = 0;
  for (const skill of job.skills) {
    const owned = worker.skills.find((item) => item.skillId === skill.skillId);
    const actual = owned ? levels.indexOf(owned.level) + 1 : 0, required = levels.indexOf(skill.minimumLevel) + 1;
    if (skill.required && !owned) reasons.push("MISSING_REQUIRED_SKILL");
    else if (skill.required && actual < required) reasons.push("BELOW_REQUIRED_SKILL_LEVEL");
    const weight = skill.required ? 2 : 1;
    skillWeight += weight; skillSum = add(skillSum, fraction(Math.min(actual, required) * weight, required));
  }
  const availabilityResult = availability(worker, job, computedAt, offsetCache);
  const cityEqual = Boolean(worker.city && job.city && worker.city.normalize("NFC").trim().toLocaleLowerCase("vi") === job.city.normalize("NFC").trim().toLocaleLowerCase("vi"));
  const compatible = job.workMode === "HYBRID" ? worker.workModes.some((mode) => mode === "HYBRID" || mode === "ON_SITE") : worker.workModes.includes(job.workMode!);
  const locationCovered = Boolean(job.workMode && worker.workModes.length && (job.workMode === "REMOTE" || (worker.city && job.city)));
  const values: Record<ComponentKey, { value: Fraction | null; explanation: string }> = {
    skills: { value: skillWeight ? { n: skillSum.n, d: skillSum.d * BigInt(skillWeight) } : null, explanation: "REQUIRED_DOUBLE_OPTIONAL_SINGLE_CAPPED_LEVEL_RATIO" },
    availability: availabilityResult,
    location: { value: locationCovered ? fraction(compatible && (job.workMode === "REMOTE" || cityEqual) ? 1 : 0) : null, explanation: "COARSE_CITY_AND_WORK_MODE" },
    compensation: { value: null, explanation: "WORKER_EXPECTATION_NOT_MODELLED" }, experience: { value: null, explanation: "EXPERIENCE_NOT_MODELLED" },
    rating: { value: reputation?.ratingCount ? fraction(reputation.ratingSum - reputation.ratingCount, 4 * reputation.ratingCount) : null, explanation: "VISIBLE_REVIEW_AVERAGE_MINUS_ONE_OVER_FOUR" },
    reliability: { value: reputation && reputation.completed + reputation.relevantCancelled > 0 ? fraction(reputation.completed, reputation.completed + reputation.relevantCancelled) : null, explanation: "COMPLETED_OVER_COMPLETED_PLUS_WORKER_CANCELLED" },
  };
  let coveredWeight = 0, total = fraction(0);
  const components = (Object.entries(matchingConfig.weights) as [ComponentKey, number][]).map(([key, weight]) => {
    const { value, explanation } = values[key];
    if (value) { coveredWeight += weight; total = add(total, { n: value.n * BigInt(weight), d: value.d }); }
    return { key, weight, covered: value !== null, score: value ? round(value, 100) : null,
      weightedContribution: value ? round({ n: value.n * BigInt(weight), d: value.d }, 100) / 100 : null, explanation };
  });
  return { eligible: !reasons.length, reasons: [...new Set(reasons)], score: reasons.length || !coveredWeight ? null : round({ n: total.n, d: total.d * BigInt(coveredWeight) }, 100),
    coverage: coveredWeight, components, weightsVersion: matchingConfig.weightsVersion, algorithmVersion: matchingConfig.algorithmVersion, computedAt: computedAt.toISOString() };
}
export function isRelevantMatch(match: Pick<MatchResult, "eligible" | "score" | "coverage">) {
  return match.eligible && match.score !== null && match.score >= 70 && match.coverage >= 60;
}
