import { describe, expect, it } from "vitest";
import { hasRole, parseRoleActivation, requireCanCreateActivity, requireRole, requireVerifiedEmail, type Principal } from "./policy";

const user: Principal = { id: "opaque", name: "Test", email: "test@example.invalid", emailVerified: false, status: "ACTIVE", roles: ["WORKER", "EMPLOYER"] };
describe("application authorization", () => {
  it("supports additive dual roles without ADMIN implication", () => {
    expect(hasRole(user, "WORKER")).toBe(true);
    expect(hasRole(user, "EMPLOYER")).toBe(true);
    expect(hasRole(user, "ADMIN")).toBe(false);
    expect(() => requireRole(user, "ADMIN")).toThrow();
    expect(requireRole(user, "ADMIN", "EMPLOYER")).toBe(user);
  });
  it.each([{ role: "ADMIN" }, { role: "admin" }, { role: ["WORKER", "ADMIN"] },
    { role: "WORKER", userId: "victim" }, { role: "EMPLOYER", status: "ACTIVE" }, { roles: ["ADMIN"] }, null])("rejects privilege/mass assignment %j", (input) => {
    expect(() => parseRoleActivation(input)).toThrow();
  });
  it.each(["WORKER", "EMPLOYER"])("permits controlled %s activation", (role) => {
    expect(parseRoleActivation({ role })).toEqual({ role });
  });
  it("requires verified state independently of role", () => {
    expect(() => requireVerifiedEmail(user)).toThrow();
    expect(requireVerifiedEmail({ ...user, emailVerified: true }).emailVerified).toBe(true);
  });
  it.each(["SUSPENDED", "BANNED"] as const)("denies new activity for %s, even ADMIN", (status) => {
    expect(() => requireCanCreateActivity({ ...user, roles: ["ADMIN"], status })).toThrow();
  });
  it("allows ACTIVE new-activity checks without inventing obligation policy", () => {
    expect(requireCanCreateActivity(user)).toBe(user);
  });
});
