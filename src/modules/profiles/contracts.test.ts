import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { availabilityIndicator, availabilitySchema, completeness, discoverySchema, employerSchema, InputError, levels, parse, workerSchema, type WorkerInput } from "./contracts";
vi.mock("server-only", () => ({}));
import { discoveryWorkerDto, selfWorkerDto } from "./service";

const complete: WorkerInput = { headline: "Hỗ trợ kế toán", city: "hà nội", bio: "", timezone: "Asia/Ho_Chi_Minh",
  preferences: ["FULL_TIME"], workModes: ["ON_SITE"], skills: [{ skillId: randomUUID(), level: "INTERMEDIATE" }], availability: [] };
describe("worker completeness, not Match Score", () => {
  it("counts only required fields", () => expect(completeness(complete)).toEqual({ complete: true, percentage: 100, missingFields: [] }));
  it.each(["PART_TIME", "TEMPORARY", "SHIFT"] as const)("requires availability for %s", (type) => {
    expect(completeness({ ...complete, preferences: [type] })).toEqual({ complete: false, percentage: 80, missingFields: ["availability"] });
    expect(completeness({ ...complete, preferences: [type], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] }).complete).toBe(true);
  });
  it("allows explicit remote without city", () => expect(completeness({ ...complete, city: null, workModes: ["REMOTE"] }).complete).toBe(true));
  it("reports empty required data deterministically", () => expect(completeness({ ...complete, headline: "", city: null, preferences: [], workModes: [], skills: [] })).toEqual({ complete: false, percentage: 0, missingFields: ["headline", "location", "workPreference", "skills"] }));
  it("does not reward optional bio", () => expect(completeness({ ...complete, bio: "Optional" })).toEqual(completeness(complete)));
});
describe("validated bounded structured inputs", () => {
  it("returns allowlisted field names without input or raw issue messages", () => {
    try { parse(workerSchema, { ...complete, timezone: "sensitive-input", privateToken: "secret" }); }
    catch (error) {
      expect(error).toBeInstanceOf(InputError);
      expect((error as InputError).fields).toEqual(["timezone", "form"]);
      expect(JSON.stringify(error)).not.toMatch(/sensitive-input|privateToken|secret|issues/);
      return;
    }
    throw new Error("Expected validation failure");
  });
  it.each(levels)("accepts level %s", (level) => expect(workerSchema.safeParse({ ...complete, skills: [{ ...complete.skills[0], level }] }).success).toBe(true));
  it.each(["MASTER", "ADMIN", "", 4])("rejects invalid level %s", (level) => expect(workerSchema.safeParse({ ...complete, skills: [{ ...complete.skills[0], level }] }).success).toBe(false));
  it("rejects duplicate skills/preferences and unknown work types", () => {
    expect(workerSchema.safeParse({ ...complete, skills: [complete.skills[0], complete.skills[0]] }).success).toBe(false);
    expect(workerSchema.safeParse({ ...complete, preferences: ["SHIFT", "SHIFT"] }).success).toBe(false);
    expect(workerSchema.safeParse({ ...complete, preferences: ["JOB"] }).success).toBe(false);
  });
  it.each(["userId", "discoverable", "percentage", "status", "email", "phone"])("rejects protected %s", (key) => expect(workerSchema.safeParse({ ...complete, [key]: "injected" }).success).toBe(false));
  it("rejects unsafe timezone and residential address numbers", () => {
    expect(workerSchema.safeParse({ ...complete, timezone: "GMT+7" }).success).toBe(false);
    expect(workerSchema.safeParse({ ...complete, city: "123 Home Street" }).success).toBe(false);
  });
  it("accepts adjacent hourly windows but rejects overlap and invalid bounds", () => {
    expect(availabilitySchema.safeParse([{ weekday: 1, startHour: 9, endHour: 12 }, { weekday: 1, startHour: 12, endHour: 17 }]).success).toBe(true);
    for (const slot of [{ weekday: 7, startHour: 9, endHour: 17 }, { weekday: 1, startHour: 17, endHour: 9 }, { weekday: 1, startHour: 9.5, endHour: 17 }]) expect(availabilitySchema.safeParse([slot]).success).toBe(false);
    expect(availabilitySchema.safeParse([{ weekday: 1, startHour: 9, endHour: 12 }, { weekday: 1, startHour: 11, endHour: 17 }]).success).toBe(false);
  });
  it.each([0, -1, 31, 10000, 1.5, "NaN"])("rejects unsafe page size %s", (limit) => expect(discoverySchema.safeParse({ limit }).success).toBe(false));
  it("accepts empty form filters and rejects arbitrary scope fields", () => {
    expect(parse(discoverySchema, { city: "", skillId: "", preference: "" }).limit).toBe(12);
    expect(discoverySchema.safeParse({ userId: randomUUID() }).success).toBe(false);
    expect(discoverySchema.safeParse({ cursor: "../secret" }).success).toBe(false);
  });
  it("rejects employer ownership injection", () => expect(employerSchema.safeParse({ type: "INDIVIDUAL", city: null, userId: "other" }).success).toBe(false));
});
describe("private availability and worker DTO projection", () => {
  it("projects only coarse discovery fields even from a wider row", () => {
    const row = { id: randomUUID(), headline: complete.headline, bio: "private", city: complete.city, timezone: complete.timezone, discoverable: true,
      userId: "private-id", user: { name: "Worker", email: "private@example.invalid", status: "SUSPENDED" },
      preferences: [{ type: "PART_TIME" as const }], workModes: [{ mode: "REMOTE" as const }],
      skills: [{ skillId: randomUUID(), level: "BEGINNER" as const, skill: { name: "Excel" } }], availability: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    const dto = discoveryWorkerDto(row);
    expect(Object.keys(dto).sort()).toEqual(["availability", "city", "displayName", "headline", "id", "preferences", "skills", "workModes"]);
    expect(dto.availability).toBe("AVAILABILITY_PROVIDED");
    expect(dto.skills).toEqual([{ name: "Excel", level: "BEGINNER" }]);
    expect(JSON.stringify(dto)).not.toMatch(/private|weekday|startHour|timezone|userId/);
    expect(selfWorkerDto(row)).not.toHaveProperty("userId");
    expect(selfWorkerDto(row).availability[0].weekday).toBe(1);
    expect(availabilityIndicator([])).toBe("NOT_SPECIFIED");
  });
});
