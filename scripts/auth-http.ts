import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseDatabaseEnv } from "../src/shared/config/env-schema";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.TEST_DATABASE_URL || process.env.AUTH_TEST_DATABASE !== "disposable") {
  console.error("BLOCKED: HTTP auth verification needs TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable.");
  process.exitCode = 2;
} else {
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: process.env.TEST_DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL, max: 5 }) });
  const messages: { to: string[]; text: string }[] = [];
  const mailSecret = randomBytes(32).toString("hex");
  const inbox = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.headers.authorization, `Bearer ${mailSecret}`);
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 65_536) throw new Error("Mail too large"); }
      messages.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end('{"id":"test-delivery"}');
    } catch { res.writeHead(400).end(); }
  });
  inbox.listen(0, "127.0.0.1");
  await once(inbox, "listening");
  const mailAddress = inbox.address();
  assert.ok(mailAddress && typeof mailAddress !== "string");
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const appAddress = portProbe.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));
  const origin = `http://127.0.0.1:${appAddress.port}`;
  const network = randomBytes(4).toString("hex");
  const clientIp = `2001:db8:${network.slice(0, 4)}:${network.slice(4)}::1`;
  const ratePrefix = `2001:0db8:${network.slice(0, 4)}:${network.slice(4)}:0000:0000:0000:0000|`;
  const email = `http-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const newPassword = randomBytes(24).toString("base64url");
  const child = fork("node_modules/next/dist/bin/next", ["dev", "--hostname", "127.0.0.1", "--port", String(appAddress.port)], {
    execArgv: ["--import", new URL("./auth-test-mail.mjs", import.meta.url).href],
    silent: true, windowsHide: true,
    env: { ...process.env, NODE_ENV: "development", DATABASE_URL, DIRECT_DATABASE_URL: DATABASE_URL,
      APP_URL: origin, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      EMAIL_PROVIDER: "resend", RESEND_API_KEY: "test-transport-only", EMAIL_FROM: "test@example.invalid",
      AUTH_HTTP_TEST: "1", AUTH_HTTP_TEST_MAIL_URL: `http://127.0.0.1:${mailAddress.port}`,
      AUTH_HTTP_TEST_MAIL_SECRET: mailSecret, NEXT_TELEMETRY_DISABLED: "1" },
  });
  // Drain output without displaying potentially sensitive framework diagnostics.
  child.stdout?.resume(); child.stderr?.resume();
  const exited = once(child, "exit");
  let stage = "server readiness";
  let userId: string | undefined;
  async function request(path: string, body?: object, cookie = "") {
    return fetch(`${origin}${path}`, { method: body ? "POST" : "GET", redirect: "manual",
      headers: { origin, cookie, "x-forwarded-for": clientIp, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  }
  function cookieOf(response: Response) { return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; "); }
  async function mailToken(path: string) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const mail = messages.filter((item) => item.to.includes(email) && item.text.includes(`${origin}${path}#token=`)).at(-1);
      if (mail) {
        const url = mail.text.match(/https?:\/\/\S+/)?.[0];
        assert.ok(url);
        return new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
      }
      await delay(250);
    }
    throw new Error("Test email not delivered");
  }
  async function signedOut(cookie: string) {
    const account = await request("/account", undefined, cookie);
    assert.equal(account.status, 307);
    assert.equal(new URL(account.headers.get("location")!, origin).pathname, "/sign-in");
    assert.equal(await (await request("/api/auth/get-session", undefined, cookie)).json(), null);
  }
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Test server exited");
      const ready = await request("/api/auth/ok").catch(() => undefined);
      if (ready?.ok) break;
      if (attempt === 119) throw new Error("Test server unavailable");
      await delay(500);
    }
    await signedOut("");
    stage = "signup and verification";
    assert.equal((await request("/sign-up")).status, 200);
    assert.equal((await request("/api/auth/sign-up/email", { name: "HTTP verification", email, password, status: "ACTIVE" })).status, 400);
    assert.equal((await request("/api/auth/sign-up/email", { name: "HTTP verification", email, password })).status, 200);
    userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
    const verification = await mailToken("/verify-email");
    assert.equal((await request("/verify-email")).headers.get("referrer-policy"), "no-referrer");
    assert.equal((await request("/api/auth/verify-email", { token: verification })).status, 200);
    stage = "login and protected account";
    const login = await request("/api/auth/sign-in/email", { email, password });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { ok: true });
    const cookie = cookieOf(login);
    assert.ok(cookie);
    assert.ok(login.headers.getSetCookie().some((value) => /httponly/i.test(value) && /samesite=lax/i.test(value)));
    assert.equal(await db.session.count({ where: { userId } }), 1);
    const account = await request("/account", undefined, cookie);
    assert.equal(account.status, 200);
    assert.ok((await account.text()).includes(email));
    const session = await (await request("/api/auth/get-session", undefined, cookie)).json();
    assert.deepEqual(Object.keys(session), ["user"]);
    assert.deepEqual(Object.keys(session.user).sort(), ["emailVerified", "id", "name"]);
    stage = "dual roles and public ADMIN rejection";
    assert.equal((await request("/api/account/roles", { role: "ADMIN" }, cookie)).status, 400);
    assert.equal((await request("/api/account/roles", { role: "WORKER" }, cookie)).status, 200);
    assert.equal((await request("/api/account/roles", { role: "WORKER" }, cookie)).status, 200);
    assert.equal((await request("/api/account/roles", { role: "EMPLOYER" }, cookie)).status, 200);
    assert.deepEqual((await db.userRole.findMany({ where: { userId }, orderBy: { role: "asc" } })).map((row) => row.role), ["WORKER", "EMPLOYER"]);
    const rolesPage = await (await request("/account", undefined, cookie)).text();
    assert.ok(rolesPage.includes("WORKER, EMPLOYER"));
    stage = "suspension and logout";
    await db.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    assert.equal((await request("/api/account/roles", { role: "WORKER" }, cookie)).status, 403);
    assert.equal((await request("/account", undefined, cookie)).status, 200);
    await db.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    assert.equal((await request("/api/auth/sign-out", {}, cookie)).status, 200);
    await signedOut(cookie);
    assert.equal(await db.session.count({ where: { userId } }), 0);
    stage = "password reset, revocation and replay";
    const beforeReset = await request("/api/auth/sign-in/email", { email, password });
    assert.equal(beforeReset.status, 200);
    assert.equal((await request("/api/auth/request-password-reset", { email })).status, 200);
    const reset = await mailToken("/reset-password");
    assert.equal((await request("/api/auth/reset-password", { token: reset, newPassword })).status, 200);
    await signedOut(cookieOf(beforeReset));
    assert.equal((await request("/api/auth/reset-password", { token: reset, newPassword: password })).status, 400);
    assert.equal((await request("/api/auth/sign-in/email", { email, password })).status, 400);
    assert.equal((await request("/api/auth/sign-in/email", { email, password: newPassword })).status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).status, "ACTIVE");
    console.info("PASS: real Next HTTP signup/verification/login/account/dual roles/ADMIN rejection/suspension/logout/reset/revocation; PostgreSQL and test-only intercepted mail.");
  } catch {
    console.error(`FAIL: HTTP auth verification at ${stage}; sensitive diagnostics suppressed.`);
    process.exitCode = 1;
  } finally {
    if (child.exitCode === null && child.connected) child.send("phase2-test-stop");
    const stopped = await Promise.race([exited.then(() => true), delay(15_000).then(() => false)]);
    if (!stopped) { child.kill(); console.error("FAIL: test server shutdown timed out."); process.exitCode = 1; }
    await new Promise<void>((resolve) => inbox.close(() => resolve()));
    try {
      userId ??= (await db.user.findUnique({ where: { email }, select: { id: true } }))?.id;
      if (userId) {
        await db.verification.deleteMany({ where: { value: userId } });
        await db.userRole.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
      await db.rateLimit.deleteMany({ where: { key: { startsWith: ratePrefix } } });
      await db.$disconnect();
    } catch { console.error("FAIL: HTTP fixture cleanup failed; sensitive diagnostics suppressed."); process.exitCode = 1; }
  }
}
