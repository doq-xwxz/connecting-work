import { expect, it, vi } from "vitest";
import { handleAuthRequest } from "./http";
import type { Auth } from "./factory";

const origin = "https://app.example.invalid";
function deps(status = 200) {
  const handler = vi.fn(async () => Response.json({ token: "never-expose", error: "SQL password secret" }, { status }));
  return { origin, getAuth: () => ({ handler }) as unknown as Auth, assertEmailReady: () => {}, handler };
}
it("rejects direct admin and role mass assignment before invoking auth", async () => {
  const dependency = deps();
  const response = await handleAuthRequest(new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.invalid", name: "Test", password: "long-test-password", role: "ADMIN" }),
  }), dependency);
  expect(response.status).toBe(400);
  expect(dependency.handler).not.toHaveBeenCalled();
});
it("does not expose a mutating verification GET", async () => {
  const dependency = deps();
  expect((await handleAuthRequest(new Request(`${origin}/api/auth/verify-email?token=secret`), dependency)).status).toBe(404);
  expect(dependency.handler).not.toHaveBeenCalled();
});
it("projects session reads without token or account credentials", async () => {
  const dependency = deps();
  dependency.handler.mockImplementationOnce(async () => Response.json({ session: { token: "never-expose" }, user: { id: "opaque", name: "Test", emailVerified: true, password: "private" } }));
  const response = await handleAuthRequest(new Request(`${origin}/api/auth/get-session`), dependency);
  expect(await response.json()).toEqual({ user: { id: "opaque", name: "Test", emailVerified: true } });
});
it("does not invoke auth on cross-origin POST", async () => {
  const dependency = deps();
  expect((await handleAuthRequest(new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin: "https://evil.invalid" } }), dependency)).status).toBe(403);
  expect(dependency.handler).not.toHaveBeenCalled();
});
it.each([200, 400, 500, 429])("sanitizes underlying auth response %s", async (status) => {
  const response = await handleAuthRequest(new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }), deps(status));
  expect(response.status).toBe(status);
  expect(await response.text()).not.toMatch(/never-expose|SQL|password|secret/);
});
it("fails safely before signup if email delivery is unavailable", async () => {
  const dependency = { ...deps(), assertEmailReady() { throw new Error("api-key-private"); } };
  const response = await handleAuthRequest(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.invalid", password: "long-test-password", name: "Test" }) }), dependency);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("api-key-private");
  expect(dependency.handler).not.toHaveBeenCalled();
});
