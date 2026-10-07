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
  async function request(path: string, body?: object, cookie = "", method = body ? "POST" : "GET") {
    return fetch(`${origin}${path}`, { method, redirect: "manual",
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
    stage = "Phase 3 HTTP profiles and private discovery";
    const api = "/api/marketplace";
    assert.equal((await request(`${api}/worker`)).status, 401);
    assert.equal((await request(`${api}/workers`)).status, 401);
    assert.equal((await request(`${api}/workers`, undefined, cookie)).status, 403);
    const skill = await db.skill.findUniqueOrThrow({ where: { slug: "excel" } });
    const workerData = { headline: "HTTP Excel", city: "Hồ Chí Minh", bio: "Private summary", timezone: "Asia/Ho_Chi_Minh",
      preferences: ["PART_TIME"], workModes: ["REMOTE"], skills: [{ skillId: skill.id, level: "INTERMEDIATE" }],
      availability: [{ weekday: 1, startHour: 9, endHour: 12 }] };
    const workerCreate = await request(`${api}/worker`, workerData, cookie);
    assert.equal(workerCreate.status, 200);
    const workerProfile = await workerCreate.json();
    assert.equal(workerProfile.discoverable, false); assert.equal(workerProfile.completeness.complete, true);
    assert.equal((await request(`${api}/worker`, workerData, cookie)).status, 409);
    assert.equal((await request(`${api}/worker/${randomUUID()}`, workerData, cookie, "PUT")).status, 404);
    assert.equal((await request(`${api}/worker/${workerProfile.id}`, { ...workerData, userId: "other" }, cookie, "PUT")).status, 400);
    assert.equal((await request(`${api}/worker/${workerProfile.id}`, { ...workerData, headline: "Updated HTTP" }, cookie, "PUT")).status, 200);
    const employerData = { type: "INDIVIDUAL", description: "HTTP employer", city: "Hồ Chí Minh" };
    const employerCreate = await request(`${api}/employer`, employerData, cookie);
    assert.equal(employerCreate.status, 200);
    const employerProfile = await employerCreate.json();
    assert.equal((await request(`${api}/employer`, employerData, cookie)).status, 409);
    assert.equal((await request(`${api}/employer/${employerProfile.id}`, employerData, cookie, "PUT")).status, 200);
    const discoveryPath = `${api}/workers?city=${encodeURIComponent("Hồ Chí Minh")}&skillId=${skill.id}&preference=PART_TIME`;
    assert.equal((await (await request(discoveryPath, undefined, cookie)).json()).items.length, 0);
    assert.equal((await request(`${api}/worker/${workerProfile.id}/discoverability`, { discoverable: true }, cookie, "PATCH")).status, 200);
    const discovered = await (await request(discoveryPath, undefined, cookie)).json();
    assert.equal(discovered.items.length, 1);
    assert.deepEqual(Object.keys(discovered.items[0]).sort(), ["availability", "city", "displayName", "headline", "id", "preferences", "skills", "workModes"]);
    assert.ok(!JSON.stringify(discovered).includes(email));
    assert.equal((await request(`${api}/workers?limit=500`, undefined, cookie)).status, 400);
    await db.userRole.delete({ where: { userId_role: { userId, role: "EMPLOYER" } } });
    assert.equal((await request(discoveryPath, undefined, cookie)).status, 403);
    await db.userRole.create({ data: { userId, role: "EMPLOYER", grantedBy: "http-fixture" } });
    for (const path of ["/worker/profile", "/worker/profile/edit", "/employer/profile", "/employer/profile/edit", "/employer/workers", "/employer/companies", "/employer/companies/new"]) {
      const page = await request(path, undefined, cookie); assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    }
    stage = "Phase 3 HTTP company ownership and allowlists";
    const companyData = { name: "HTTP company", description: "Foundation", city: "Hồ Chí Minh", website: null };
    const creationKey = randomUUID();
    const companyCreate = await request(`${api}/companies`, { ...companyData, creationKey }, cookie);
    assert.equal(companyCreate.status, 200);
    const company = await companyCreate.json();
    assert.equal(company.verification, "UNVERIFIED"); assert.equal(company.role, "OWNER");
    assert.equal((await (await request(`${api}/companies`, { ...companyData, creationKey }, cookie)).json()).id, company.id);
    assert.equal((await request(`${api}/companies/${company.slug}`, undefined, cookie)).status, 200);
    assert.equal((await request(`/employer/companies/${company.slug}`, undefined, cookie)).status, 200);
    assert.equal((await request(`${api}/company/${company.id}`, { ...companyData, name: "Updated company" }, cookie, "PUT")).status, 200);
    assert.equal((await request(`${api}/company/${company.id}`, { ...companyData, verification: "VERIFIED" }, cookie, "PUT")).status, 400);
    assert.equal((await request(`${api}/company/${company.id}/members`, {}, cookie)).status, 404);
    const members = await (await request(`${api}/company/${company.id}/members`, undefined, cookie)).json();
    assert.deepEqual(members.items, [{ memberId: userId, displayName: "HTTP verification", role: "OWNER" }]);
    assert.equal((await request(`${api}/company/${company.id}/members/${userId}`, {}, cookie, "DELETE")).status, 409);
    const crossOrigin = await fetch(`${origin}${api}/worker`, { method: "POST", headers: { origin: "https://other.invalid", cookie, "content-type": "application/json" }, body: JSON.stringify(workerData) });
    assert.equal(crossOrigin.status, 403);
    stage = "Phase 4 HTTP jobs, privacy, publishing and quota";
    const jobData = { title: "HTTP job", description: "HTTP structured terms", category: "FINANCE_ACCOUNTING", employmentType: "PART_TIME", workMode: "REMOTE", city: "Hồ Chí Minh",
      compensationType: "HOURLY", compensationMin: "50000", compensationMax: "80000", currency: "VND", headcount: 2, startDate: "2026-11-01", endDate: "2026-11-30", timezone: "Asia/Ho_Chi_Minh",
      skills: [{ skillId: skill.id, required: true, minimumLevel: "INTERMEDIATE" }], schedule: [{ weekday: 1, startHour: 9, endHour: 17 }] };
    const jobsPath = `${api}/employer-jobs`;
    const jobBody = () => ({ ...jobData, companyId: null, creationKey: randomUUID() });
    async function createHttpJob(companyId: string | null = null) {
      const response = await request(jobsPath, { ...jobBody(), companyId }, cookie); assert.equal(response.status, 200); return response.json();
    }
    async function moveHttpJob(job: { id: string; version: number }, action: string, expected = 200) {
      const response = await request(`${jobsPath}/${job.id}/${action}`, { expectedVersion: job.version }, cookie);
      assert.equal(response.status, expected); return response.json();
    }
    assert.equal((await request("/jobs")).status, 200);
    assert.equal((await request(`${api}/jobs`)).status, 200);
    assert.equal((await request(jobsPath, jobBody())).status, 401);
    assert.equal((await request(jobsPath)).status, 401);
    assert.equal((await fetch(`${origin}${jobsPath}`, { method: "POST", headers: { origin: "https://other.invalid", cookie, "content-type": "application/json" }, body: JSON.stringify(jobBody()) })).status, 403);
    assert.equal((await request(jobsPath, { ...jobBody(), status: "PUBLISHED" }, cookie)).status, 400);
    assert.equal((await request(jobsPath, { ...jobBody(), createdByUserId: userId }, cookie)).status, 400);
    assert.equal((await request(jobsPath, { ...jobBody(), compensationMin: "1.5" }, cookie)).status, 400);
    assert.equal((await request(jobsPath, { ...jobBody(), companyId: randomUUID() }, cookie)).status, 404);
    await db.user.update({ where: { id: userId }, data: { emailVerified: false } });
    let firstJob = await createHttpJob();
    await moveHttpJob(firstJob, "publish", 403);
    assert.equal((await request(`${api}/jobs/${firstJob.id}`)).status, 404);
    assert.equal((await request(`/jobs/${firstJob.id}`)).status, 404);
    await db.user.update({ where: { id: userId }, data: { emailVerified: true } });
    firstJob = await moveHttpJob(firstJob, "publish");
    let secondJob = await moveHttpJob(await createHttpJob(), "publish");
    const thirdJob = await moveHttpJob(await createHttpJob(), "publish");
    let fourthJob = await createHttpJob(); await moveHttpJob(fourthJob, "publish", 409);
    firstJob = await moveHttpJob(firstJob, "pause"); assert.equal(firstJob.quota.active, 3);
    assert.equal((await request(`${api}/jobs/${firstJob.id}`)).status, 404);
    firstJob = await moveHttpJob(firstJob, "resume");
    firstJob = await moveHttpJob(firstJob, "close"); await moveHttpJob(firstJob, "publish", 409);
    fourthJob = await moveHttpJob(fourthJob, "publish");
    const duplicateResponse = await request(`${jobsPath}/${firstJob.id}/duplicate`, { creationKey: randomUUID() }, cookie);
    assert.equal(duplicateResponse.status, 200); const duplicateJob = await duplicateResponse.json();
    assert.equal(duplicateJob.status, "DRAFT"); assert.notEqual(duplicateJob.id, firstJob.id); assert.equal(duplicateJob.publishedAt, null);
    let companyJob = await moveHttpJob(await createHttpJob(company.id), "publish");
    const editResponse = await request(`${jobsPath}/${companyJob.id}`, { ...jobData, description: "Edited HTTP terms", expectedVersion: companyJob.version }, cookie, "PUT");
    assert.equal(editResponse.status, 200); companyJob = await editResponse.json();
    await moveHttpJob(companyJob, "completed", 404);
    const publicResponse = await request(`${api}/jobs/${companyJob.id}`); assert.equal(publicResponse.status, 200);
    const publicJob = await publicResponse.json(); assert.equal(publicJob.owner.kind, "COMPANY");
    assert.equal(publicJob.compensationMin, "50000");
    for (const value of [email, userId, employerProfile.id]) assert.ok(!JSON.stringify(publicJob).includes(value));
    assert.ok(!Object.hasOwn(publicJob, "createdByUserId")); assert.ok(!Object.hasOwn(publicJob, "companyId"));
    assert.equal((await request(`/jobs/${companyJob.id}`)).status, 200);
    for (const path of ["/employer/jobs", "/employer/jobs/new", `/employer/jobs/${companyJob.id}`, `/employer/jobs/${companyJob.id}/edit`]) assert.equal((await request(path, undefined, cookie)).status, 200);
    for (const query of ["limit=1000", "status=DRAFT", "limit=1&limit=2"]) assert.equal((await request(`${api}/jobs?${query}`)).status, 400);
    await db.userRole.delete({ where: { userId_role: { userId, role: "EMPLOYER" } } });
    assert.equal((await request(jobsPath, jobBody(), cookie)).status, 403);
    await db.userRole.create({ data: { userId, role: "EMPLOYER", grantedBy: "http-fixture" } });
    stage = "suspension and logout";
    await db.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    assert.equal((await request(jobsPath, jobBody(), cookie)).status, 403);
    await moveHttpJob(duplicateJob, "publish", 403);
    assert.equal((await request(`${jobsPath}/${thirdJob.id}/duplicate`, { creationKey: randomUUID() }, cookie)).status, 403);
    secondJob = await moveHttpJob(secondJob, "pause"); await moveHttpJob(secondJob, "resume", 403);
    await moveHttpJob(secondJob, "close"); await moveHttpJob(fourthJob, "cancel");
    assert.equal((await request("/api/account/roles", { role: "WORKER" }, cookie)).status, 403);
    assert.equal((await request(`${api}/worker/${workerProfile.id}`, workerData, cookie, "PUT")).status, 403);
    assert.equal((await request(`${api}/company/${company.id}`, companyData, cookie, "PUT")).status, 403);
    assert.equal((await request(discoveryPath, undefined, cookie)).status, 403);
    assert.equal((await request(`${api}/worker/${workerProfile.id}/discoverability`, { discoverable: false }, cookie, "PATCH")).status, 200);
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
    console.info("PASS: real Next HTTP Phase 2 auth, Phase 3 profiles/company/discovery and Phase 4 jobs/pages/privacy/quota/ownership/status regressions; PostgreSQL and test-only intercepted mail.");
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
        const jobIds = (await db.job.findMany({ where: { createdByUserId: userId }, select: { id: true } })).map((item) => item.id);
        await db.jobSkill.deleteMany({ where: { jobId: { in: jobIds } } });
        await db.jobScheduleWindow.deleteMany({ where: { jobId: { in: jobIds } } });
        await db.job.deleteMany({ where: { id: { in: jobIds } } });
        const companyIds = (await db.company.findMany({ where: { createdByUserId: userId }, select: { id: true } })).map((item) => item.id);
        await db.companyMember.deleteMany({ where: { companyId: { in: companyIds } } });
        await db.company.deleteMany({ where: { id: { in: companyIds } } });
        await db.workerProfile.deleteMany({ where: { userId } });
        await db.employerProfile.deleteMany({ where: { userId } });
        await db.verification.deleteMany({ where: { value: userId } });
        await db.userRole.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
      await db.rateLimit.deleteMany({ where: { key: { startsWith: ratePrefix } } });
      await db.$disconnect();
    } catch { console.error("FAIL: HTTP fixture cleanup failed; sensitive diagnostics suppressed."); process.exitCode = 1; }
  }
}
