import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { actions, createJobSchema, jobSchema, managementQuerySchema, moneySchema, publicQuerySchema, statuses, updateJobSchema, type JobInput } from "./contracts";
import { classifyJobEdit, duplicateTerms, isActive, jobTerms, nextStatus, ownsJob, publishValidation, requireEditableTerms, requireQuota } from "./policy";
import { managedJobDto, publicJobDto, type JobRow } from "./projection";

const terms: JobInput = { title: "Hỗ trợ Excel", description: "Đối chiếu dữ liệu", category: "FINANCE_ACCOUNTING", employmentType: "PART_TIME", workMode: "REMOTE", city: null,
  compensationType: "HOURLY", compensationMin: "50000", compensationMax: "70000", currency: "VND", headcount: 2,
  startDate: "2026-11-01", endDate: "2026-11-30", timezone: "Asia/Ho_Chi_Minh",
  skills: [{ skillId: randomUUID(), required: true, minimumLevel: "INTERMEDIATE" }], schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
describe("exact job inputs and publish validation", () => {
  it("allows incomplete drafts while requiring structured publish terms", () => {
    const draft = { ...terms, title: "", description: "", category: null, employmentType: null, workMode: null, compensationType: null, compensationMin: null, compensationMax: null, skills: [], schedule: [] };
    expect(jobSchema.safeParse(draft).success).toBe(true); expect(publishValidation(draft).valid).toBe(false);
    expect(publishValidation(terms)).toEqual({ valid: true, missingFields: [] });
    expect(publishValidation(terms, false).missingFields).toContain("skills");
  });
  it.each([0, -1, 1001, 1.5, "2"])("rejects invalid headcount %s", (headcount) => expect(jobSchema.safeParse({ ...terms, headcount }).success).toBe(false));
  it.each(["1.5", "1e3", "-1", "01", "1000000000001", 50000, NaN])("rejects invalid money %s", (amount) => expect(moneySchema.safeParse(amount).success).toBe(false));
  it("accepts exact zero/fixed/range and rejects inverted/partial compensation", () => {
    expect(jobSchema.safeParse({ ...terms, compensationMin: "0", compensationMax: "0" }).success).toBe(true);
    expect(moneySchema.safeParse("1000000000000").success).toBe(true);
    for (const override of [{ compensationMax: "40000" }, { compensationMin: null }, { compensationType: null }, { currency: "USD" }]) expect(jobSchema.safeParse({ ...terms, ...override }).success).toBe(false);
  });
  it.each(["2026-02-30", "2026-13-01", "2026-10-10T00:00:00Z", "1999-01-01"])("rejects invalid date %s", (startDate) => expect(jobSchema.safeParse({ ...terms, startDate }).success).toBe(false));
  it("checks date order, timezone, skill duplicates and schedule overlap", () => {
    for (const override of [{ endDate: "2026-10-01" }, { startDate: null }, { timezone: "GMT+7" }, { skills: [...terms.skills, ...terms.skills] },
      { schedule: [...terms.schedule, { weekday: 1, startHour: 10, endHour: 12 }] }, { schedule: [{ weekday: 8, startHour: 9, endHour: 17 }] }]) expect(jobSchema.safeParse({ ...terms, ...override }).success).toBe(false);
    expect(jobSchema.safeParse({ ...terms, startDate: "2028-02-29", endDate: "2028-02-29" }).success).toBe(true);
  });
  it.each(["PART_TIME", "TEMPORARY", "SHIFT"] as const)("requires recurring schedule for %s", (employmentType) => expect(publishValidation({ ...terms, employmentType, schedule: [] }).missingFields).toContain("schedule"));
  it.each(["ON_SITE", "HYBRID"] as const)("requires coarse location for %s", (workMode) => expect(publishValidation({ ...terms, workMode }).missingFields).toContain("location"));
  it("does not require calendar fields for full time", () => expect(publishValidation({ ...terms, employmentType: "FULL_TIME", schedule: [], startDate: null, endDate: null }).valid).toBe(true));
  it.each(["status", "createdByUserId", "employerProfileId", "verification", "occupiedHeadcount", "companyId", "email", "phone", "version"])("rejects protected edit field %s", (key) => expect(updateJobSchema.safeParse({ ...terms, expectedVersion: 1, [key]: "injected" }).success).toBe(false));
  it("requires explicit creation ownership/key and edit version", () => {
    expect(createJobSchema.safeParse({ ...terms, companyId: null, creationKey: randomUUID() }).success).toBe(true);
    expect(createJobSchema.safeParse(terms).success).toBe(false); expect(updateJobSchema.safeParse(terms).success).toBe(false);
  });
  it("bounds recruiting text, unique skill sets and schedule windows", () => {
    const skills = Array.from({ length: 21 }, () => ({ ...terms.skills[0], skillId: randomUUID() }));
    for (const override of [{ title: "x".repeat(161) }, { description: "x".repeat(6001) }, { skills },
      { schedule: Array.from({ length: 15 }, (_, index) => ({ weekday: Math.floor(index / 3), startHour: index % 3, endHour: index % 3 + 1 })) }]) {
      expect(jobSchema.safeParse({ ...terms, ...override }).success).toBe(false);
    }
  });
  it.each([0, 31, "NaN", 1.5])("bounds public page size %s", (limit) => expect(publicQuerySchema.safeParse({ limit }).success).toBe(false));
  it("rejects arbitrary public scope and accepts empty form filters", () => {
    expect(publicQuerySchema.safeParse({ employmentType: "", workMode: "", category: "" }).success).toBe(true);
    expect(publicQuerySchema.safeParse({ status: "DRAFT" }).success).toBe(false);
    expect(publicQuerySchema.safeParse({ cursor: "../private" }).success).toBe(false);
    expect(managementQuerySchema.safeParse({ personal: "true", companyId: randomUUID() }).success).toBe(false);
  });
});
describe("job lifecycle, quota and ownership", () => {
  const valid = new Map([ ["DRAFT:publish", "PUBLISHED"], ["DRAFT:cancel", "CANCELLED"], ["PUBLISHED:pause", "PAUSED"], ["PAUSED:resume", "PUBLISHED"],
    ["PUBLISHED:close", "CLOSED"], ["PAUSED:close", "CLOSED"], ["PUBLISHED:cancel", "CANCELLED"], ["PAUSED:cancel", "CANCELLED"] ]);
  for (const status of statuses) for (const action of actions) it(`${status} / ${action}`, () => {
    const target = valid.get(`${status}:${action}`);
    if (target) expect(nextStatus(status, action)).toBe(target); else expect(() => nextStatus(status, action)).toThrow();
  });
  it("counts PAUSED and PUBLISHED only; resume does not add a slot", () => {
    expect(statuses.filter(isActive)).toEqual(["PUBLISHED", "PAUSED"]);
    expect(() => requireQuota(3, "DRAFT")).toThrow(); expect(() => requireQuota(3, "PAUSED")).not.toThrow(); expect(() => requireQuota(4, "PAUSED")).toThrow();
  });
  it("uses personal ownership or current company membership independently of provenance", () => {
    expect(ownsJob("own", { employerProfileId: "own", companyId: null }, false)).toBe(true);
    expect(ownsJob("other", { employerProfileId: "own", companyId: null }, true)).toBe(false);
    expect(ownsJob("own", { employerProfileId: "own", companyId: "company" }, false)).toBe(false);
    expect(ownsJob("other", { employerProfileId: "own", companyId: "company" }, true)).toBe(true);
  });
});
describe("material edit seam and snapshot/duplicate projections", () => {
  it("locks material fields with real future hiring context; allows wording changes", () => {
    const context = { phase: "HIRING" as const, hasApplications: true, occupiedSlots: 2 };
    expect(() => requireEditableTerms(terms, { ...terms, compensationMax: "80000" }, context)).toThrow();
    expect(() => requireEditableTerms(terms, { ...terms, headcount: 1 }, { ...context, hasApplications: false })).toThrow();
    expect(() => requireEditableTerms(terms, { ...terms, description: "Wording" }, context)).not.toThrow();
    expect(() => requireEditableTerms(terms, { ...terms, headcount: 3 }, { phase: "PRE_HIRING" })).not.toThrow();
    expect(classifyJobEdit(terms, { ...terms, workMode: "HYBRID" }).material).toContain("workMode");
  });
  it("makes detached serializable terms and copies no lifecycle/identity/history", () => {
    const wider = { ...terms, id: "private", status: "CLOSED", createdByUserId: "private", applications: ["private"], publishedAt: new Date() };
    const duplicated = duplicateTerms(wider); expect(duplicated).toEqual(terms); expect(JSON.stringify(duplicated)).not.toContain("private");
    duplicated.skills[0].required = false; expect(terms.skills[0].required).toBe(true);
    expect(jobTerms(terms).schemaVersion).toBe(1);
  });
});
describe("job DTO projection", () => {
  it("projects public terms/owner without private IDs; keeps management fields separately", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    const row: JobRow = { ...terms, id: randomUUID(), status: "PUBLISHED", version: 1, currency: "VND", employerProfileId: "private-profile", companyId: "private-company",
      compensationMin: 50000n, compensationMax: 70000n, startDate: new Date("2026-11-01T00:00:00Z"), endDate: new Date("2026-11-30T00:00:00Z"),
      createdAt: now, updatedAt: now, publishedAt: now, closedAt: null, cancelledAt: null,
      employer: { user: { name: "Personal identity" } }, company: { name: "Company", slug: "company-route", verification: "UNVERIFIED" },
      skills: terms.skills.map((skill) => ({ ...skill, skill: { name: "Excel", active: true } })) };
    const publicDto = publicJobDto(row); expect(JSON.stringify(publicDto)).not.toMatch(/private|email|createdBy|employerProfileId|companyId|status|version|active/);
    expect(publicDto.compensationMin).toBe("50000"); expect(publicDto.startDate).toBe("2026-11-01"); expect(publicDto.skills[0].name).toBe("Excel");
    const managed = managedJobDto(row, { scope: "COMPANY", active: 3, limit: 3 }); expect(managed.status).toBe("PUBLISHED"); expect(managed.quota.active).toBe(3);
    expect(JSON.stringify(managed)).not.toMatch(/private-profile|private-company/);
  });
});
