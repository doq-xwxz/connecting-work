import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applicationActions, applicationStatuses, engagementActions, engagementStatuses, offerStatuses, offerSchema, snapshotSchema, acceptedSnapshotSchema, cancellationSchema, applySchema } from "./contracts";
import { applicationTransition, engagementTransition, expired, occupiedStatuses, requireCapacity, requireEligibility, requirePending } from "./policy";
import { offerDto, engagementDto } from "./projection";
import { requireEditableTerms } from "@/modules/jobs/policy";
import type { JobInput } from "@/modules/jobs/contracts";
import type { WorkerInput } from "@/modules/profiles/contracts";

const skillId = randomUUID();
const job: JobInput = { title: "Excel", description: "Terms", category: "FINANCE_ACCOUNTING", employmentType: "PART_TIME", workMode: "REMOTE", city: null,
  compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2, startDate: "2026-11-01", endDate: "2026-11-30", timezone: "Asia/Ho_Chi_Minh",
  skills: [{ skillId, required: true, minimumLevel: "INTERMEDIATE" }], schedule: [{ weekday: 1, startHour: 9, endHour: 12 }] };
const worker: WorkerInput = { headline: "Excel specialist", bio: "", city: null, timezone: "Asia/Ho_Chi_Minh", preferences: ["PART_TIME"], workModes: ["REMOTE"], skills: [{ skillId, level: "INTERMEDIATE" }], availability: [{ weekday: 2, startHour: 20, endHour: 22 }] };
const now = new Date("2026-10-08T00:00:00.000Z");
const snapshot = { schemaVersion: 1 as const, jobId: randomUUID(), jobVersion: 2, ownerId: randomUUID(), owner: { kind: "COMPANY" as const, displayName: "Company", companySlug: "company", verification: "VERIFIED" as const }, job, createdAt: now.toISOString(), expiresAt: null };

describe("application actions", () => {
  const allowed = new Map<string, string>([["APPLIED/view", "VIEWED"], ["VIEWED/view", "VIEWED"], ["APPLIED/shortlist", "SHORTLISTED"], ["VIEWED/shortlist", "SHORTLISTED"], ["SHORTLISTED/shortlist", "SHORTLISTED"],
    ...["APPLIED", "VIEWED", "SHORTLISTED", "OFFERED"].flatMap((state): [string, string][] => [[`${state}/reject`, "REJECTED"], [`${state}/withdraw`, "WITHDRAWN"]]), ["REJECTED/reject", "REJECTED"], ["WITHDRAWN/withdraw", "WITHDRAWN"]]);
  for (const status of applicationStatuses) for (const action of applicationActions) it(`${status} / ${action}`, () => {
    const target = allowed.get(`${status}/${action}`);
    if (target) expect(applicationTransition(status, action, false, false)).toBe(target);
    else expect(() => applicationTransition(status, action, false, false)).toThrow();
    expect(() => applicationTransition(status, action, true, false)).toThrow();
  });
  it("requires revoke before reject and permits withdrawal cleanup", () => {
    expect(() => applicationTransition("OFFERED", "reject", false, true)).toThrow();
    expect(applicationTransition("OFFERED", "withdraw", false, true)).toBe("WITHDRAWN");
  });
});
describe("offer and engagement lifecycle", () => {
  it.each(offerStatuses)("only PENDING is actionable: %s", (status) => {
    if (status === "PENDING") expect(() => requirePending(status)).not.toThrow(); else expect(() => requirePending(status)).toThrow();
  });
  const allowed = new Map<string, string>([["ACCEPTED/start", "IN_PROGRESS"], ["IN_PROGRESS/start", "IN_PROGRESS"], ["IN_PROGRESS/request-completion", "IN_PROGRESS"], ["IN_PROGRESS/confirm-completion", "COMPLETED"], ["COMPLETED/confirm-completion", "COMPLETED"], ["ACCEPTED/cancel", "CANCELLED"], ["IN_PROGRESS/cancel", "CANCELLED"], ["CANCELLED/cancel", "CANCELLED"]]);
  for (const status of engagementStatuses) for (const action of engagementActions) it(`${status} / ${action}`, () => {
    const target = allowed.get(`${status}/${action}`);
    if (target) expect(engagementTransition(status, action, true)).toBe(target); else expect(() => engagementTransition(status, action, true)).toThrow();
  });
  it("requires completion request", () => expect(() => engagementTransition("IN_PROGRESS", "confirm-completion", false)).toThrow());
  it("bounds party cancellation", () => {
    expect(cancellationSchema.safeParse({ category: "OTHER", reason: "Reason" }).success).toBe(true);
    for (const override of [{ reason: "" }, { reason: "x".repeat(501) }, { category: "FORCE_CANCEL" }, { cancelledBy: randomUUID() }]) expect(cancellationSchema.safeParse({ category: "OTHER", reason: "Reason", ...override }).success).toBe(false);
  });
});
describe("eligibility and capacity", () => {
  it("uses minimum completeness and required skill ordering; not matching overlap", () => {
    expect(() => requireEligibility("Name", worker, job)).not.toThrow();
    for (const level of ["INTERMEDIATE", "ADVANCED", "EXPERT"] as const) expect(() => requireEligibility("Name", { ...worker, skills: [{ skillId, level }] }, job)).not.toThrow();
    expect(() => requireEligibility("Name", { ...worker, skills: [{ skillId, level: "BEGINNER" }] }, job)).toThrow();
    expect(() => requireEligibility("Name", { ...worker, skills: [{ skillId: randomUUID(), level: "EXPERT" }] }, job)).toThrow();
    expect(() => requireEligibility("Name", worker, { ...job, skills: [{ skillId: randomUUID(), required: false, minimumLevel: "EXPERT" }] })).not.toThrow();
  });
  it("requires minimum identity/profile and availability only where required", () => {
    expect(() => requireEligibility("", worker, job)).toThrow();
    for (const override of [{ headline: "" }, { workModes: [] }, { preferences: [] }, { skills: [] }, { availability: [] }]) expect(() => requireEligibility("Name", { ...worker, ...override }, job)).toThrow();
    expect(() => requireEligibility("Name", { ...worker, preferences: ["FULL_TIME"], availability: [] }, { ...job, employmentType: "FULL_TIME" })).not.toThrow();
  });
  it("counts completed and excludes cancelled slots", () => {
    expect(occupiedStatuses).toEqual(["ACCEPTED", "IN_PROGRESS", "COMPLETED"]);
    expect(() => requireCapacity(0, 1)).not.toThrow(); expect(() => requireCapacity(1, 1)).toThrow(); expect(() => requireCapacity(2, 1)).toThrow();
  });
  it("expires at the exact server boundary; no expiry remains valid", () => {
    expect(expired(null, now)).toBe(false); expect(expired(new Date(now.getTime() + 1), now)).toBe(false);
    expect(expired(now, now)).toBe(true); expect(expired(new Date(now.getTime() - 1), now)).toBe(true);
  });
  it("uses actual hiring edit context and preserves wording edits", () => {
    expect(() => requireEditableTerms(job, { ...job, headcount: 1 }, { phase: "HIRING", hasApplications: true, occupiedSlots: 2 })).toThrow();
    expect(() => requireEditableTerms(job, { ...job, headcount: 3 }, { phase: "HIRING", hasApplications: true, occupiedSlots: 1 })).toThrow();
    expect(() => requireEditableTerms(job, { ...job, description: "Wording" }, { phase: "HIRING", hasApplications: true, occupiedSlots: 1 })).not.toThrow();
  });
});
describe("strict inputs and snapshot projection", () => {
  it("rejects identity/status injection and invalid offer terms", () => {
    expect(applySchema.safeParse({ creationKey: randomUUID(), workerProfileId: randomUUID() }).success).toBe(false);
    for (const override of [{ status: "ACCEPTED" }, { compensationMin: "1e3", compensationMax: "2000" }, { compensationMin: "2000", compensationMax: "1000" }, { compensationMin: "1000" }, { expiresAt: "tomorrow" }]) expect(offerSchema.safeParse({ creationKey: randomUUID(), expiresAt: null, ...override }).success).toBe(false);
  });
  it("validates structured exact money and serializes a detached snapshot", () => {
    const parsed = snapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    parsed.job.skills[0].required = false; expect(job.skills[0].required).toBe(true);
    expect(parsed.job.compensationMin).toBe("50000");
    expect(snapshotSchema.safeParse({ ...snapshot, schemaVersion: 2 }).success).toBe(false);
    expect(acceptedSnapshotSchema.safeParse({ schemaVersion: 1, offer: snapshot, worker: { displayName: "Name", headline: "Headline" }, acceptedAt: now.toISOString() }).success).toBe(true);
  });
  it("keeps version 1 historical text readable without new ingress normalization", () => {
    const description = "Legacy\r\nwording\u0085";
    expect(snapshotSchema.parse({ ...snapshot, job: { ...snapshot.job, description } }).job.description).toBe(description.trim());
  });
  it("allowlists DTO terms and strips owner identity provenance", () => {
    const offer = offerDto({ id: randomUUID(), revision: 1, status: "PENDING", terms: snapshot, createdAt: now, expiresAt: null, resolvedAt: null });
    expect(JSON.stringify(offer)).not.toContain(snapshot.ownerId); expect(JSON.stringify(offer)).not.toContain("ownerId");
    const engagement = engagementDto({ id: randomUUID(), status: "ACCEPTED", terms: { schemaVersion: 1, offer: snapshot, worker: { displayName: "Worker", headline: "Headline" }, acceptedAt: now.toISOString() }, acceptedAt: now,
      startedAt: null, completionRequestedAt: null, completedAt: null, cancelledAt: null, cancellationCategory: null, cancellationReason: null });
    expect(JSON.stringify(engagement)).not.toContain(snapshot.ownerId); expect(engagement.terms.owner.displayName).toBe("Company");
  });
});
