import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { companySchema, companySlug, createCompanySchema, publicCompanyDto, requireCompanyRole } from "./contracts";
const input = { name: "Công ty Đổi Mới", city: "Hà Nội", website: "https://example.invalid", description: "" };
describe("company policies and safe inputs", () => {
  it("owner and manager may manage, only owner may administer membership", () => {
    expect(() => requireCompanyRole("OWNER", "OWNER")).not.toThrow();
    expect(() => requireCompanyRole("MANAGER", "MANAGER")).not.toThrow();
    expect(() => requireCompanyRole("MANAGER", "OWNER")).toThrow();
  });
  it("normalizes Vietnamese slugs with collision-resistant server suffix", () => {
    expect(companySlug(input.name, "abc123")).toBe("cong-ty-doi-moi-abc123");
    expect(companySlug("😃", "abc123")).toBe("cong-ty-abc123");
    expect(companySlug("A".repeat(300), "abc123").length).toBeLessThan(70);
  });
  it.each(["verification", "verified", "OWNER", "createdByUserId", "slug", "members"])("rejects injected %s", (key) => expect(companySchema.safeParse({ ...input, [key]: "VERIFIED" }).success).toBe(false));
  it.each(["javascript:alert(1)", "https://user:password@example.invalid", "file:///tmp/a"])("rejects unsafe website %s", (website) => expect(companySchema.safeParse({ ...input, website }).success).toBe(false));
  it("requires a bounded retry key", () => {
    expect(createCompanySchema.safeParse({ ...input, creationKey: randomUUID() }).success).toBe(true);
    expect(createCompanySchema.safeParse(input).success).toBe(false);
  });
  it("projects public company without creator/member identity", () => {
    const dto = publicCompanyDto({ ...input, city: "hà nội", slug: "cong-ty-test", verification: "UNVERIFIED" });
    expect(Object.keys(dto).sort()).toEqual(["city", "description", "name", "slug", "verification", "website"]);
  });
});
