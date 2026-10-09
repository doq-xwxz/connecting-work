import { describe, expect, it } from "vitest";
import type { WorkerInput } from "@/modules/profiles/contracts";
import type { JobInput } from "@/modules/jobs/contracts";
import { publicQuerySchema } from "@/modules/jobs/contracts";
import { isRelevantMatch, matchingConfig, matchWorkerJob } from "./algorithm";

const now = new Date("2026-10-08T00:00:00Z");
const worker: WorkerInput = { headline: "Excel", bio: "", city: "hà nội", timezone: "Asia/Ho_Chi_Minh", preferences: ["FULL_TIME"], workModes: ["REMOTE", "ON_SITE"],
  skills: [{ skillId: "11111111-1111-4111-8111-111111111111", level: "INTERMEDIATE" }], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] };
const job: JobInput = { title: "Excel", description: "Data", category: "FINANCE_ACCOUNTING", employmentType: "FULL_TIME", workMode: "REMOTE", city: null,
  compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 1,
  startDate: null, endDate: null, timezone: "Asia/Ho_Chi_Minh", skills: [{ skillId: worker.skills[0].skillId, required: true, minimumLevel: "INTERMEDIATE" }], schedule: worker.availability };
const match = (w: Partial<WorkerInput> = {}, j: Partial<JobInput> = {}, status = "PUBLISHED") => matchWorkerJob({ ...worker, ...w }, "Name", { ...job, ...j }, status, now);
const component = (result: ReturnType<typeof match>, key: string) => result.components.find((item) => item.key === key)!;
describe("matching v2 trusted reputation", () => {
  it.each([[1, 0], [2, 25], [3, 50], [4, 75], [5, 100]])("maps %s stars to %s", (ratingSum, expected) => {
    const result = matchWorkerJob(worker, "Name", job, "PUBLISHED", now, undefined, { ratingSum, ratingCount: 1, completed: 0, relevantCancelled: 0 });
    expect(component(result, "rating").score).toBe(expected); expect(result.coverage).toBe(75);
  });
  it("uses exact sum/count and outcome ratio without presentation rounding", () => {
    const result = matchWorkerJob(worker, "Name", job, "PUBLISHED", now, undefined, { ratingSum: 17, ratingCount: 4, completed: 2, relevantCancelled: 1 });
    expect(result.coverage).toBe(80); expect(result.score).toBe(97); expect(component(result, "rating").score).toBe(81); expect(component(result, "reliability").score).toBe(67);
  });
  it("adds covered history only and keeps relevance thresholds", () => {
    const result = matchWorkerJob({ ...worker, availability: [] }, "Name", job, "PUBLISHED", now, undefined, { ratingSum: 5, ratingCount: 1, completed: 1, relevantCancelled: 0 });
    expect(result.coverage).toBe(60); expect(result.score).toBe(100); expect(isRelevantMatch(result)).toBe(true);
  });
});
describe("versioned deterministic matching", () => {
  it("keeps exactly the approved seven weights and deterministic output", () => {
    expect(Object.values(matchingConfig.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(matchingConfig.weights).toEqual({ skills: 35, availability: 20, location: 15, compensation: 10, experience: 10, rating: 5, reliability: 5 });
    expect(match()).toEqual(match()); expect(match().weightsVersion).toBe("v1"); expect(match().algorithmVersion).toBe("deterministic-v2");
    expect(match()).toMatchObject({ eligible: true, score: 100, coverage: 70, computedAt: now.toISOString() });
  });
  it.each(["compensation", "experience", "rating", "reliability"])("leaves absent trusted %s uncovered", (key) => expect(component(match(), key)).toMatchObject({ covered: false, score: null, weightedContribution: null }));
  it("normalizes observed weights without inventing missing values", () => {
    const result = match({ availability: [] }); expect(result.score).toBe(100); expect(result.coverage).toBe(50); expect(isRelevantMatch(result)).toBe(false);
    expect(component(result, "availability").covered).toBe(false);
  });
  it("zero measured overlap remains covered and reduces score", () => {
    const result = match({ availability: [{ weekday: 2, startHour: 9, endHour: 17 }] });
    expect(component(result, "availability").score).toBe(0); expect(result.coverage).toBe(70); expect(result.score).toBe(71);
  });
  it("computes half-open recurring overlap and rounds final rational once", () => {
    const result = match({ availability: [{ weekday: 1, startHour: 9, endHour: 12 }] });
    expect(component(result, "availability").score).toBe(38); expect(result.score).toBe(82);
    expect(match({ availability: [{ weekday: 1, startHour: 17, endHour: 18 }] }).score).toBe(71);
  });
  it("compares different timezone windows in UTC rather than local hours", () => {
    const result = match({ timezone: "UTC", availability: [{ weekday: 1, startHour: 2, endHour: 10 }] });
    expect(component(result, "availability").score).toBe(100);
    expect(component(match({ timezone: "UTC" }), "availability").score).toBe(13);
  });
  it("handles cross-week timezone wrapping", () => {
    const result = match({ timezone: "UTC", availability: [{ weekday: 6, startHour: 18, endHour: 19 }] }, { schedule: [{ weekday: 0, startHour: 1, endHour: 2 }] });
    expect(component(result, "availability").score).toBe(100);
  });
  it("leaves differing-zone DST transition week uncovered", () => {
    const result = match({ timezone: "America/New_York" }, { startDate: "2026-03-08" });
    expect(component(result, "availability")).toMatchObject({ covered: false, explanation: "TIMEZONE_TRANSITION_UNCOVERED" });
  });
  it("same-zone recurring DST comparison remains local", () => {
    expect(component(match({ timezone: "America/New_York" }, { timezone: "America/New_York", startDate: "2026-03-08" }), "availability").score).toBe(100);
  });
  it("missing required skill and below level are distinct hard gates", () => {
    expect(match({ skills: [{ skillId: "22222222-2222-4222-8222-222222222222", level: "EXPERT" }] })).toMatchObject({ eligible: false, score: null, reasons: ["MISSING_REQUIRED_SKILL"] });
    expect(match({ skills: [{ ...worker.skills[0], level: "BEGINNER" }] })).toMatchObject({ eligible: false, score: null, reasons: ["BELOW_REQUIRED_SKILL_LEVEL"] });
  });
  it("optional missing skills score zero without hard exclusion and required counts double", () => {
    const result = match({}, { skills: [...job.skills, { skillId: "22222222-2222-4222-8222-222222222222", required: false, minimumLevel: "EXPERT" }] });
    expect(result.eligible).toBe(true); expect(component(result, "skills").score).toBe(67); expect(result.score).toBe(83);
  });
  it("optional partial levels contribute a capped ratio", () => {
    expect(component(match({}, { skills: [{ ...job.skills[0], required: false, minimumLevel: "EXPERT" }] }), "skills").score).toBe(50);
    expect(component(match({ skills: [{ ...worker.skills[0], level: "EXPERT" }] }), "skills").score).toBe(100);
  });
  it.each([["BEGINNER", 63], ["INTERMEDIATE", 75], ["ADVANCED", 88], ["EXPERT", 100]] as const)("rounds exact final half upward for optional %s", (level, expected) => {
    const result = match({ skills: [{ ...worker.skills[0], level }] }, { skills: [{ ...job.skills[0], required: false, minimumLevel: "EXPERT" }] });
    expect(result.score).toBe(expected); expect(result.coverage).toBe(70);
  });
  it.each(["DRAFT", "CLOSED", "CANCELLED", "COMPLETED"])("rejects unmatchable %s", (status) => expect(match({}, {}, status).reasons).toContain("JOB_NOT_MATCHABLE"));
  it("permits PAUSED for employer suggestions", () => expect(match({}, {}, "PAUSED").eligible).toBe(true));
  it("keeps profile and job-specific availability minimum from hiring", () => {
    expect(match({ headline: "" }).reasons).toContain("WORKER_PROFILE_INCOMPLETE");
    expect(match({ availability: [] }, { employmentType: "SHIFT" }).reasons).toContain("WORKER_PROFILE_INCOMPLETE");
  });
  it.each(["ON_SITE", "HYBRID"] as const)("coarse same-city %s is full, mismatch is measured zero and never hard deny", (workMode) => {
    expect(component(match({}, { workMode, city: "HÀ NỘI" }), "location").score).toBe(100);
    const result = match({}, { workMode, city: "đà nẵng" }); expect(component(result, "location").score).toBe(0); expect(result.eligible).toBe(true);
  });
  it("remote requires compatible mode; missing city stays unknown for onsite", () => {
    expect(component(match({ workModes: ["ON_SITE"] }), "location").score).toBe(0);
    expect(component(match({ city: null }, { workMode: "ON_SITE", city: "hà nội" }), "location").covered).toBe(false);
  });
  it.each([[true, 70, 60, true], [true, 69, 60, false], [true, 70, 59, false], [false, 100, 100, false], [true, null, 100, false]] as const)("shared relevance boundary %s/%s/%s", (eligible, score, coverage, expected) => expect(isRelevantMatch({ eligible, score, coverage })).toBe(expected));
});
describe("search boundaries", () => {
  it("normalizes Unicode and accepts plain empty text", () => { expect(publicQuerySchema.parse({ q: "  DỮ   LIỆU " }).q).toBe("dữ liệu"); expect(publicQuerySchema.parse({ q: "" }).q).toBe(""); });
  it.each(["x".repeat(201), "a ".repeat(21), "excel | data", "' OR 1=1 --", '"excel"', "a:*", "a & b"])("rejects unsafe or excessive syntax %s", (q) => expect(publicQuerySchema.safeParse({ q }).success).toBe(false));
  it("requires comparable compensation units and ordered bounds", () => {
    expect(publicQuerySchema.safeParse({ compensationMin: "100" }).success).toBe(false);
    expect(publicQuerySchema.safeParse({ compensationType: "HOURLY", compensationMin: "100", compensationMax: "99" }).success).toBe(false);
    expect(publicQuerySchema.safeParse({ compensationType: "HOURLY", compensationMin: "invalid", compensationMax: "99" }).success).toBe(false);
  });
});
