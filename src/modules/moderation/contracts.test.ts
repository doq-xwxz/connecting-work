import { describe, expect, it } from "vitest";
import { accountTransition, actionSchema, actionTarget, closeSchema, createCaseSchema, forceTransition, reportSchema, requireBinding, requireOpenCase } from "./contracts";

const id = "92a267a1-fc58-4d41-87df-2037c851c24a";
describe("moderation boundary", () => {
  it("rejects actor/status/HTML fields, unsupported targets and dangling formats", () => {
    const body = { targetType: "JOB", targetId: id, reasonCode: "SPAM", details: null };
    expect(reportSchema.safeParse(body).success).toBe(true);
    for (const patch of [{ reporterUserId: id }, { status: "RESOLVED" }, { targetType: "PAYMENT" }, { targetId: "not-a-uuid" }]) expect(reportSchema.safeParse({ ...body, ...patch }).success).toBe(false);
    expect(actionSchema.safeParse({ targetId: id, reasonCode: "SPAM", reason: "Reason", adminUserId: id }).success).toBe(false);
  });
  it.each(["", " ", "\u200b", "\u0000", "\ud800", "x".repeat(2001)])("rejects empty/control/ill-formed/oversized text", (reason) => {
    expect(actionSchema.safeParse({ targetId: id, reasonCode: "OTHER", reason }).success).toBe(false);
  });
  it("requires OTHER details and normalizes bounded plain text", () => {
    expect(reportSchema.safeParse({ targetType: "JOB", targetId: id, reasonCode: "OTHER", details: null }).success).toBe(false);
    const text = "<script>alert(1)</script>\r\nplain text";
    expect(reportSchema.parse({ targetType: "JOB", targetId: id, reasonCode: "OTHER", details: text }).details).toBe(text.replace("\r\n", "\n"));
  });
  it("accepts only bounded explicit case commands", () => {
    expect(createCaseSchema.safeParse({ targetType: "ENGAGEMENT", targetId: id, severity: "HIGH", reasonCode: "OTHER", reason: "Case context" }).success).toBe(true);
    expect(closeSchema.safeParse({ resolutionCode: "REOPEN", reasonCode: "OTHER", reason: "Reason" }).success).toBe(false);
    expect(() => requireOpenCase("CLOSED")).toThrow();
    for (const status of ["OPEN", "INVESTIGATING", "ACTIONED"]) expect(() => requireOpenCase(status)).not.toThrow();
  });
  it("binds both resource type and identity", () => {
    expect(() => requireBinding("REVIEW", id, "JOB", id)).toThrow();
    expect(() => requireBinding("JOB", id, "JOB", "other")).toThrow();
    expect(() => requireBinding("JOB", id, "JOB", id)).not.toThrow();
    expect(actionTarget("force-cancel")).toBe("ENGAGEMENT"); expect(actionTarget("ban")).toBe("USER");
  });
});
describe("exceptional lifecycle policy", () => {
  it.each(["ACTIVE", "SUSPENDED", "BANNED"])("account transitions from %s", (status) => {
    for (const action of ["suspend", "unsuspend", "ban"] as const) {
      const allowed = action === "suspend" ? status === "ACTIVE" : action === "unsuspend" ? status === "SUSPENDED" : status !== "BANNED";
      if (allowed) expect(accountTransition(status, action)).toBe(action === "suspend" ? "SUSPENDED" : action === "unsuspend" ? "ACTIVE" : "BANNED");
      else expect(() => accountTransition(status, action)).toThrow();
    }
  });
  it.each(["ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])("force lifecycle from %s", (status) => {
    if (status === "IN_PROGRESS") expect(forceTransition(status, "force-complete")).toBe("COMPLETED"); else expect(() => forceTransition(status, "force-complete")).toThrow();
    if (["ACCEPTED", "IN_PROGRESS"].includes(status)) expect(forceTransition(status, "force-cancel")).toBe("CANCELLED"); else expect(() => forceTransition(status, "force-cancel")).toThrow();
  });
});
