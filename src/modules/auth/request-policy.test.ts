import { describe, expect, it } from "vitest";
import { parseAuthBody, readJsonBody, requireSameOrigin, safeLocalRedirect } from "./request-policy";

describe("origin and redirects", () => {
  it.each([undefined, "null", "https://attacker.invalid", "https://app.example.invalid.attacker.invalid"])("rejects origin %s", (origin) => {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    expect(() => requireSameOrigin(new Request("https://app.example.invalid/api", { headers }), "https://app.example.invalid")).toThrow();
  });
  it("rejects cross-site metadata even with a claimed origin", () => {
    expect(() => requireSameOrigin(new Request("https://app.example.invalid", { headers: { origin: "https://app.example.invalid", "sec-fetch-site": "cross-site" } }), "https://app.example.invalid")).toThrow();
  });
  it("accepts same-origin mutation", () => {
    expect(() => requireSameOrigin(new Request("https://app.example.invalid", { headers: { origin: "https://app.example.invalid" } }), "https://app.example.invalid")).not.toThrow();
  });
  it.each(["//attacker.invalid", "https://attacker.invalid", "/\\attacker.invalid", "javascript:alert(1)", "/\nattacker", undefined])("rejects unsafe redirect %s", (input) => {
    expect(safeLocalRedirect(input)).toBe("/account");
  });
  it("accepts a same-site relative path", () => expect(safeLocalRedirect("/account?tab=roles")).toBe("/account?tab=roles"));
});
describe("strict auth input", () => {
  const signup = { name: "Test", email: "test@example.invalid", password: "test-only-long-password" };
  it.each([{ ...signup, role: "ADMIN" }, { ...signup, roles: ["ADMIN"] }, { ...signup, status: "ACTIVE" },
    { ...signup, emailVerified: true }, { ...signup, callbackURL: "https://attacker.invalid" }])("rejects malicious signup fields", (input) => {
    expect(() => parseAuthBody("/sign-up/email", input)).toThrow();
  });
  it("does not expose raw invalid inputs in errors", () => {
    try { parseAuthBody("/reset-password", { token: "secret-token", newPassword: "short" }); }
    catch (error) { expect(String(error)).not.toMatch(/secret-token|short/); }
  });
  it("bounds chunked body bytes", async () => {
    const request = new Request("https://app.example.invalid/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "a".repeat(17000) }) });
    await expect(readJsonBody(request)).rejects.toThrow();
  });
});
