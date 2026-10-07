import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createAuth } from "../src/modules/auth/factory";
import { handleAuthRequest } from "../src/modules/auth/http";
import { grantNormalRole, resolvePrincipal } from "../src/modules/auth/service";
import { requireCanCreateActivity } from "../src/modules/auth/policy";
import type { AuthEmail } from "../src/shared/email/contract";
import { createEmailVerificationToken } from "better-auth/api";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";

nextEnv.loadEnvConfig(process.cwd());
// Explicit operator consent, never infer a production URL from DATABASE_URL.
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: configure TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable; apply committed migrations to that database first.");
  process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 5 }) });
  const messages: AuthEmail[] = []; // Test-only fake provider. Never used by app runtime.
  const origin = "http://localhost:3099";
  const suffix = randomUUID();
  const email = `auth-${suffix}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const newPassword = randomBytes(24).toString("base64url");
  const auth = createAuth(db, { origin, secret: randomBytes(48).toString("base64url"), production: false }, {
    async send(message) { messages.push(message); },
  });
  const dependency = { origin, getAuth: () => auth, assertEmailReady() {} };
  async function request(path: string, body: object, cookie = "") {
    return handleAuthRequest(new Request(`${origin}/api/auth/${path}`, { method: "POST",
      headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), dependency);
  }
  function cookieOf(response: Response) { return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; "); }
  function lastToken(kind: AuthEmail["kind"]) {
    const mail = messages.filter((item) => item.kind === kind).at(-1);
    assert.ok(mail);
    return new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token")!;
  }
  let userId: string | undefined;
  try {
    assert.equal((await request("sign-up/email", { email, name: "Integration", password, role: "ADMIN" })).status, 400);
    assert.equal((await request("sign-up/email", { email, name: "Integration", password })).status, 200);
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { roles: true } });
    userId = user.id;
    assert.equal(user.emailVerified, false);
    assert.equal(user.status, "ACTIVE");
    assert.equal(user.roles.length, 0);
    assert.notEqual((await request("sign-in/email", { email, password })).status, 200);
    const expiredVerification = await createEmailVerificationToken((await auth.$context).secret, email, undefined, -1);
    assert.notEqual((await request("verify-email", { token: expiredVerification })).status, 200);
    assert.equal((await request("verify-email", { token: lastToken("verification") })).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, true);
    const duplicateSignup = await request("sign-up/email", { email, name: "Duplicate", password });
    assert.equal(duplicateSignup.status, 200);
    assert.deepEqual(await duplicateSignup.json(), { ok: true });
    // Tampered tokens cannot verify any account.
    assert.notEqual((await request("verify-email", { token: "invalid-expired-token" })).status, 200);
    const signIn = await request("sign-in/email", { email, password }, "better-auth.session_token=attacker-fixed-cookie");
    assert.equal(signIn.status, 200);
    const cookie = cookieOf(signIn);
    assert.ok(cookie);
    assert.ok(!cookie.includes("attacker-fixed-cookie"));
    assert.ok(signIn.headers.getSetCookie().some((value) => /httponly/i.test(value) && /samesite=lax/i.test(value)));
    const headers = new Headers({ cookie });
    const principal = await resolvePrincipal(auth, db, headers);
    assert.equal(principal.id, user.id);
    await assert.rejects(() => grantNormalRole(db, principal, { role: "ADMIN" }));
    await Promise.all([grantNormalRole(db, principal, { role: "WORKER" }), grantNormalRole(db, principal, { role: "WORKER" })]);
    await grantNormalRole(db, principal, { role: "EMPLOYER" });
    assert.equal(await db.userRole.count({ where: { userId: user.id } }), 2);
    await db.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    const suspended = await resolvePrincipal(auth, db, headers);
    assert.equal(suspended.status, "SUSPENDED");
    assert.throws(() => requireCanCreateActivity(suspended));
    // Stale ACTIVE principal must not bypass current DB status.
    await assert.rejects(() => grantNormalRole(db, principal, { role: "WORKER" }));
    assert.equal((await request("sign-out", {}, cookie)).status, 200);
    await assert.rejects(() => resolvePrincipal(auth, db, headers));
    await db.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });
    const beforeReset = await request("sign-in/email", { email, password });
    assert.equal(beforeReset.status, 200);
    assert.equal((await request("request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
    const reset = lastToken("password-reset");
    assert.equal((await request("reset-password", { token: reset, newPassword })).status, 200);
    assert.notEqual((await request("reset-password", { token: reset, newPassword: password })).status, 200);
    await assert.rejects(() => resolvePrincipal(auth, db, new Headers({ cookie: cookieOf(beforeReset) })));
    assert.notEqual((await request("sign-in/email", { email, password })).status, 200);
    const newSignIn = await request("sign-in/email", { email, password: newPassword });
    assert.equal(newSignIn.status, 200);
    assert.equal((await request("request-password-reset", { email })).status, 200);
    const expiredReset = lastToken("password-reset");
    await db.verification.updateMany({ where: { value: user.id }, data: { expiresAt: new Date(0) } });
    assert.notEqual((await request("reset-password", { token: expiredReset, newPassword: password })).status, 200);
    const missingEmail = `missing-${suffix}@example.invalid`;
    const unknownReset = await request("request-password-reset", { email: missingEmail });
    assert.equal(unknownReset.status, 200);
    assert.deepEqual(await unknownReset.json(), { ok: true });
    // Separate auth object reads persisted DB sessions (no in-process auth store).
    const anotherAuth = createAuth(db, { origin, secret: (await auth.$context).secret, production: false }, { async send() {} });
    assert.ok(await anotherAuth.api.getSession({ headers: new Headers({ cookie: cookieOf(newSignIn) }) }));
    console.info("PASS: PostgreSQL auth, verification/reset, fixation/logout/revocation, dual roles/uniqueness and suspension tested with fake email delivery.");
  } catch {
    console.error("FAIL: PostgreSQL auth integration failed; details suppressed to avoid credentials/tokens.");
    process.exitCode = 1;
  } finally {
    try {
      userId ??= (await db.user.findUnique({ where: { email }, select: { id: true } }))?.id;
      if (userId) {
        await db.verification.deleteMany({ where: { value: userId } });
        await db.userRole.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
    } catch {
      console.error("FAIL: Integration fixture cleanup failed; operator review required. Details suppressed.");
      process.exitCode = 1;
    }
    try { await db.$disconnect(); }
    catch {
      console.error("FAIL: Integration database disconnect failed. Details suppressed.");
      process.exitCode = 1;
    }
  }
}
