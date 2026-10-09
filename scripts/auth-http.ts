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
import { cleanupModerationFixtures } from "./moderation-test-cleanup";

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
  const ratePrefixes = [ratePrefix];
  const candidateAddresses = new Map<string, string>();
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
  const hiringUsers: string[] = [];
  async function request(path: string, body?: object, cookie = "", method = body ? "POST" : "GET", address = candidateAddresses.get(cookie) ?? clientIp) {
    return fetch(`${origin}${path}`, { method, redirect: "manual",
      headers: { origin, cookie, "x-forwarded-for": address, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  }
  function cookieOf(response: Response) { return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; "); }
  async function mailToken(path: string, recipient = email) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const mail = messages.filter((item) => item.to.includes(recipient) && item.text.includes(`${origin}${path}#token=`)).at(-1);
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
    stage = "Phase 5 HTTP multi-user hiring identities";
    async function hiringWorker() {
      // Independent people use independent test networks; preserve real auth limits.
      const candidateNetwork = randomBytes(4).toString("hex");
      const address = `2001:db8:${candidateNetwork.slice(0, 4)}:${candidateNetwork.slice(4)}::1`;
      ratePrefixes.push(`2001:0db8:${candidateNetwork.slice(0, 4)}:${candidateNetwork.slice(4)}:0000:0000:0000:0000|`);
      const workerEmail = `hiring-http-${randomUUID()}@example.invalid`;
      assert.equal((await request("/api/auth/sign-up/email", { name: "HTTP candidate", email: workerEmail, password }, "", "POST", address)).status, 200);
      const workerUser = await db.user.findUniqueOrThrow({ where: { email: workerEmail } }); hiringUsers.push(workerUser.id);
      assert.equal((await request("/api/auth/verify-email", { token: await mailToken("/verify-email", workerEmail) }, "", "POST", address)).status, 200);
      const login = await request("/api/auth/sign-in/email", { email: workerEmail, password }, "", "POST", address); assert.equal(login.status, 200);
      const candidateCookie = cookieOf(login);
      candidateAddresses.set(candidateCookie, address);
      assert.equal((await request("/api/account/roles", { role: "WORKER" }, candidateCookie)).status, 200);
      assert.equal((await request(`${api}/worker`, workerData, candidateCookie)).status, 200);
      return { cookie: candidateCookie, id: workerUser.id, email: workerEmail };
    }
    const wa = await hiringWorker(), wb = await hiringWorker(), wc = await hiringWorker();
    async function hiringPost(path: string, body: object, actorCookie: string, expected = 200) {
      const response = await request(`${api}/${path}`, body, actorCookie); assert.equal(response.status, expected); return response.json();
    }
    stage = "Phase 5 HTTP apply, scope, explicit pipeline and material restrictions";
    const applyKey = randomUUID();
    const appA = await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: applyKey }, wa.cookie);
    stage = "Phase 7 HTTP Application entitlement, send, retry, pagination, privacy and blocks";
    const conversation = await hiringPost(`worker-applications/${appA.id}/conversation`, {}, wa.cookie);
    assert.equal((await hiringPost(`employer-applications/${appA.id}/conversation`, {}, cookie)).id, conversation.id);
    const workerChat = `worker-conversations/${conversation.id}`, employerChat = `employer-conversations/${conversation.id}`;
    const messageBody = { creationKey: randomUUID(), body: "<script>alert('plain')</script>\r\nHello" };
    const workerMessage = await hiringPost(`${workerChat}/messages`, messageBody, wa.cookie);
    assert.equal((await hiringPost(`${workerChat}/messages`, messageBody, wa.cookie)).id, workerMessage.id);
    await hiringPost(`${workerChat}/messages`, { ...messageBody, body: "Changed" }, wa.cookie, 409);
    await hiringPost(`${workerChat}/messages`, { ...messageBody, senderUserId: wa.id }, wa.cookie, 400);
    await hiringPost(`${workerChat}/messages`, { ...messageBody, senderSide: "EMPLOYER" }, wa.cookie, 400);
    await hiringPost(`${workerChat}/messages`, { creationKey: randomUUID(), body: "x".repeat(20_000) }, wa.cookie, 400);
    const employerMessage = await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Employer reply" }, cookie);
    for (const secret of [wa.id, wa.email, "senderUserId", "emailVerified"]) assert.ok(!JSON.stringify(employerMessage).includes(secret));
    assert.equal((await request(`${api}/${workerChat}`, undefined, wb.cookie)).status, 404);
    assert.equal((await request(`${api}/${employerChat}`, undefined, wa.cookie)).status, 403);
    assert.equal((await request(`${api}/worker-conversations?limit=51`, undefined, wa.cookie)).status, 400);
    assert.equal((await request(`${api}/${workerChat}/messages?limit=1&limit=2`, undefined, wa.cookie)).status, 400);
    const recentMessage = await (await request(`${api}/${workerChat}/messages?limit=1`, undefined, wa.cookie)).json();
    assert.equal(recentMessage.items[0].id, employerMessage.id);
    const olderMessage = await (await request(`${api}/${workerChat}/messages?before=${recentMessage.oldest}&limit=1`, undefined, wa.cookie)).json(); assert.equal(olderMessage.items[0].id, workerMessage.id);
    const polled = await (await request(`${api}/${workerChat}/messages?after=${workerMessage.id}`, undefined, wa.cookie)).json(); assert.equal(polled.items[0].id, employerMessage.id);
    const notificationPage = await (await request(`${api}/notifications`, undefined, wa.cookie)).json();
    const messageNotification = notificationPage.items.find((n: { messageId: string }) => n.messageId === employerMessage.id); assert.ok(messageNotification);
    await hiringPost(`notifications/${messageNotification.id}/read`, { messageId: employerMessage.id }, wb.cookie, 404);
    await hiringPost(`notifications/${messageNotification.id}/read`, { messageId: employerMessage.id }, wa.cookie);
    await hiringPost(`${workerChat}/read`, { messageId: workerMessage.id }, wa.cookie);
    assert.equal((await (await request(`${api}/worker-conversations`, undefined, wa.cookie)).json()).unreadMessages, 0);
    const crossSend = await fetch(`${origin}${api}/${workerChat}/messages`, { method: "POST", headers: { origin: "https://other.invalid", cookie: wa.cookie, "content-type": "application/json" }, body: JSON.stringify(messageBody) }); assert.equal(crossSend.status, 403);
    await hiringPost(`${workerChat}/block`, { messageId: employerMessage.id, blocked: true }, wa.cookie);
    await hiringPost(`${workerChat}/messages`, { creationKey: randomUUID(), body: "Blocked" }, wa.cookie, 403);
    await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Reverse blocked" }, cookie, 403);
    assert.equal((await request(`${api}/${workerChat}/messages`, undefined, wa.cookie)).status, 200);
    await hiringPost(`${workerChat}/block`, { messageId: employerMessage.id, blocked: false }, wa.cookie);
    await db.user.update({ where: { id: wa.id }, data: { status: "SUSPENDED" } });
    await hiringPost(`${workerChat}/messages`, { creationKey: randomUUID(), body: "New recruiting denied" }, wa.cookie, 403);
    await db.user.update({ where: { id: wa.id }, data: { status: "ACTIVE" } });
    const wm = await hiringWorker();
    assert.equal((await request("/api/account/roles", { role: "EMPLOYER" }, wm.cookie)).status, 200);
    assert.equal((await request(`${api}/employer`, { type: "INDIVIDUAL", city: null, description: "" }, wm.cookie)).status, 200);
    await db.companyMember.create({ data: { companyId: company.id, userId: wm.id, role: "MANAGER" } });
    await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Manager authorship" }, wm.cookie);
    assert.equal((await request(`${api}/company/${company.id}/members/${wm.id}`, {}, cookie, "DELETE")).status, 200);
    assert.equal((await request(`${api}/${employerChat}`, undefined, wm.cookie)).status, 404);
    await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Former manager" }, wm.cookie, 404);
    assert.equal((await (await request(`${api}/employer-conversations`, undefined, wm.cookie)).json()).items.length, 0);
    assert.equal((await request(`${api}/messages/${wa.id}`, { body: "Arbitrary DM" }, cookie)).status, 404);
    for (const [path, actorCookie] of [["/worker/messages", wa.cookie], ["/employer/messages", cookie], [`/worker/messages/${conversation.id}`, wa.cookie], [`/employer/messages/${conversation.id}`, cookie], ["/notifications", wa.cookie]]) {
      const messagePage = await request(path, undefined, actorCookie); assert.equal(messagePage.status, 200); assert.equal(messagePage.headers.get("referrer-policy"), "no-referrer");
      const html = await messagePage.text(); if (path.endsWith(conversation.id)) { assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>alert('plain')</script>")); }
    }
    stage = "Phase 5 HTTP apply, scope, explicit pipeline and material restrictions";
    assert.equal((await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: applyKey }, wa.cookie)).id, appA.id);
    await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID() }, wa.cookie, 409);
    await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID(), workerProfileId: workerProfile.id }, wb.cookie, 400);
    await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID() }, cookie, 403);
    assert.equal((await request(`${api}/worker-applications/${appA.id}`, undefined, wb.cookie)).status, 404);
    const crossApply = await fetch(`${origin}${api}/jobs/${companyJob.id}/apply`, { method: "POST", headers: { origin: "https://other.invalid", cookie: wb.cookie, "content-type": "application/json" }, body: JSON.stringify({ creationKey: randomUUID() }) });
    assert.equal(crossApply.status, 403);
    assert.equal((await request(`${api}/worker-applications`)).status, 401);
    assert.equal((await request(`${api}/worker-applications?limit=1000`, undefined, wa.cookie)).status, 400);
    const applicantList = await (await request(`${jobsPath}/${companyJob.id}/applications?limit=1`, undefined, cookie)).json();
    assert.equal(applicantList.items[0].status, "APPLIED");
    assert.equal(applicantList.items[0].worker.displayName, "HTTP candidate");
    const employerView = await (await request(`${api}/employer-applications/${appA.id}`, undefined, cookie)).json();
    for (const secret of [wa.email, wa.id, "workerProfileId", "userId", "sessions"]) assert.ok(!JSON.stringify(employerView).includes(secret));
    assert.equal(employerView.status, "APPLIED");
    await hiringPost(`employer-applications/${appA.id}/view`, {}, cookie);
    await hiringPost(`employer-applications/${appA.id}/shortlist`, {}, cookie);
    await hiringPost(`employer-applications/${appA.id}/shortlist`, { status: "ACCEPTED" }, cookie, 400);
    assert.equal((await request(`${jobsPath}/${companyJob.id}`, { ...jobData, compensationMin: "60000", expectedVersion: companyJob.version }, cookie, "PUT")).status, 409);
    assert.equal((await request(`${jobsPath}/${companyJob.id}`, { ...jobData, city: "Hà Nội", expectedVersion: companyJob.version }, cookie, "PUT")).status, 409);
    stage = "Phase 5 HTTP immutable revisions, decline, revoke and closed acceptance";
    const offerBody = () => ({ creationKey: randomUUID(), expiresAt: null });
    let offerA = await hiringPost(`employer-applications/${appA.id}/offers`, offerBody(), cookie);
    await hiringPost(`offers/${offerA.id}/accept`, {}, wb.cookie, 404);
    await hiringPost(`employer-applications/${appA.id}/reject`, {}, cookie, 409);
    await hiringPost(`offers/${offerA.id}/revoke`, {}, cookie);
    await hiringPost(`offers/${offerA.id}/accept`, {}, wa.cookie, 409);
    offerA = await hiringPost(`employer-applications/${appA.id}/offers`, offerBody(), cookie);
    await hiringPost(`offers/${offerA.id}/decline`, {}, wa.cookie);
    offerA = await hiringPost(`employer-applications/${appA.id}/offers`, { ...offerBody(), compensationMin: "65000", compensationMax: "75000" }, cookie);
    assert.equal(offerA.revision, 3); assert.equal(offerA.terms.job.compensationMin, "65000"); assert.ok(!Object.hasOwn(offerA.terms, "ownerId"));
    const latestOfferPage = await request(`/worker/applications/${appA.id}?limit=1`, undefined, wa.cookie);
    assert.equal(latestOfferPage.status, 200);
    const latestOfferHtml = await latestOfferPage.text();
    assert.ok(latestOfferHtml.includes("Đề nghị hiện tại")); assert.ok(latestOfferHtml.includes("65.000"));
    const appB = await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID() }, wb.cookie);
    await hiringPost(`employer-applications/${appB.id}/shortlist`, {}, cookie);
    const offerB = await hiringPost(`employer-applications/${appB.id}/offers`, offerBody(), cookie);
    const appC = await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID() }, wc.cookie);
    await hiringPost(`worker-applications/${appC.id}/withdraw`, {}, wc.cookie);
    await hiringPost(`jobs/${companyJob.id}/apply`, { creationKey: randomUUID() }, wc.cookie, 409);
    companyJob = await moveHttpJob(companyJob, "close");
    await hiringPost(`employer-applications/${appA.id}/offers`, offerBody(), cookie, 409);
    const acceptedA = await hiringPost(`offers/${offerA.id}/accept`, {}, wa.cookie);
    const acceptedB = await hiringPost(`offers/${offerB.id}/accept`, {}, wb.cookie);
    assert.equal((await hiringPost(`offers/${offerA.id}/accept`, {}, wa.cookie)).engagement.id, acceptedA.engagement.id);
    assert.equal(await db.engagement.count({ where: { jobId: companyJob.id } }), 2);
    await moveHttpJob(companyJob, "cancel", 409);
    stage = "Phase 7 HTTP active obligation survives block, CLOSED, opt-out and suspension";
    await hiringPost(`${workerChat}/block`, { messageId: employerMessage.id, blocked: true }, wa.cookie);
    await db.user.update({ where: { id: wa.id }, data: { status: "SUSPENDED" } });
    await hiringPost(`${workerChat}/messages`, { creationKey: randomUUID(), body: "Active obligation remains available" }, wa.cookie);
    await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Active work reply" }, cookie);
    await db.user.update({ where: { id: wa.id }, data: { status: "ACTIVE" } });
    stage = "Phase 5 HTTP engagement completion and cancellation";
    await hiringPost(`worker-engagements/${acceptedA.engagement.id}/start`, {}, wa.cookie, 403);
    await hiringPost(`employer-engagements/${acceptedA.engagement.id}/confirm-completion`, {}, cookie, 409);
    await hiringPost(`employer-engagements/${acceptedA.engagement.id}/start`, {}, cookie);
    const requested = await hiringPost(`worker-engagements/${acceptedA.engagement.id}/request-completion`, {}, wa.cookie);
    assert.equal(requested.engagement.status, "IN_PROGRESS");
    await hiringPost(`employer-engagements/${acceptedA.engagement.id}/confirm-completion`, {}, cookie);
    await hiringPost(`worker-engagements/${acceptedB.engagement.id}/cancel`, { category: "SCHEDULE", reason: "Cannot continue" }, wb.cookie);
    companyJob = await moveHttpJob(companyJob, "complete"); assert.equal(companyJob.status, "COMPLETED");
    await hiringPost(`${workerChat}/messages`, { creationKey: randomUUID(), body: "Terminal denied" }, wa.cookie, 403);
    assert.equal((await request(`${api}/${workerChat}/messages`, undefined, wa.cookie)).status, 200);
    await hiringPost(`${workerChat}/block`, { messageId: employerMessage.id, blocked: false }, wa.cookie);
    await hiringPost(`${employerChat}/messages`, { creationKey: randomUUID(), body: "Terminal still read-only" }, cookie, 403);
    assert.deepEqual((await (await request(`${api}/worker-applications/${appA.id}`, undefined, wa.cookie)).json()).matchAtApply, appA.matchAtApply);
    stage = "Phase 5 HTTP cancellation cleanup, rejection and pages";
    let cleanupJob = await moveHttpJob(await createHttpJob(company.id), "publish");
    const cleanupApp = await hiringPost(`jobs/${cleanupJob.id}/apply`, { creationKey: randomUUID() }, wc.cookie);
    await hiringPost(`employer-applications/${cleanupApp.id}/shortlist`, {}, cookie);
    const pending = await hiringPost(`employer-applications/${cleanupApp.id}/offers`, offerBody(), cookie);
    const rejectedApp = await hiringPost(`jobs/${cleanupJob.id}/apply`, { creationKey: randomUUID() }, wb.cookie);
    await hiringPost(`employer-applications/${rejectedApp.id}/reject`, {}, cookie);
    await hiringPost(`jobs/${cleanupJob.id}/apply`, { creationKey: randomUUID() }, wb.cookie, 409);
    cleanupJob = await moveHttpJob(cleanupJob, "cancel");
    assert.equal((await (await request(`${api}/worker-applications/${cleanupApp.id}`, undefined, wc.cookie)).json()).status, "CANCELLED");
    assert.equal((await db.offer.findUniqueOrThrow({ where: { id: pending.id } })).status, "REVOKED");
    await hiringPost(`offers/${pending.id}/accept`, {}, wc.cookie, 409);
    for (const [path, actorCookie] of [["/worker/applications", wa.cookie], [`/worker/applications/${appA.id}`, wa.cookie], [`/employer/jobs/${companyJob.id}/applications`, cookie], [`/employer/applications/${appA.id}`, cookie]]) {
      const page = await request(path, undefined, actorCookie); assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    }
    assert.equal((await request(`/worker/applications/${appA.id}`, undefined, wb.cookie)).status, 404);
    assert.equal((await request(`${api}/worker-applications/${appA.id}/offers?limit=1`, undefined, wa.cookie)).status, 200);
    stage = "Phase 6 HTTP search, recommendations, privacy and immutable match snapshot";
    const matchJob = await moveHttpJob(await createHttpJob(company.id), "publish");
    const search = await request(`${api}/jobs?q=${encodeURIComponent(jobData.title)}`); assert.equal(search.status, 200);
    assert.ok((await search.json()).items.some((item: { id: string }) => item.id === matchJob.id));
    assert.equal((await request(`${api}/jobs?q=a:*`)).status, 400);
    assert.equal((await request(`${api}/jobs?q=x&q=y`)).status, 400);
    assert.equal((await request(`${api}/worker-recommendations`)).status, 401);
    assert.equal((await request(`${jobsPath}/${matchJob.id}/candidates`)).status, 401);
    assert.equal((await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, wa.cookie)).status, 403);
    assert.equal((await request(`${api}/worker-recommendations?workerId=${userId}`, undefined, wa.cookie)).status, 400);
    assert.equal((await request(`${api}/worker-recommendations?score=100`, undefined, wa.cookie)).status, 400);
    const recommended = await (await request(`${api}/worker-recommendations`, undefined, wa.cookie)).json();
    const matchingJob = recommended.items.find((item: { id: string }) => item.id === matchJob.id);
    assert.ok(matchingJob); assert.equal(matchingJob.match.weightsVersion, "v1"); assert.equal(matchingJob.match.components.length, 7);
    const candidateProfile = await db.workerProfile.findUniqueOrThrow({ where: { userId: wa.id } });
    assert.equal((await (await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, cookie)).json()).items.length, 0);
    assert.equal((await request(`${api}/worker/${candidateProfile.id}/discoverability`, { discoverable: true }, wa.cookie, "PATCH")).status, 200);
    const privateCandidates = await (await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, cookie)).json();
    assert.equal(privateCandidates.items.length, 1); assert.equal(privateCandidates.items[0].id, candidateProfile.id);
    const candidateJson = JSON.stringify(privateCandidates);
    for (const forbidden of [wa.email, wa.id, "userId", "startHour", "endHour", "timezone", "emailVerified"]) assert.equal(candidateJson.includes(forbidden), false);
    for (const [path, actorCookie] of [["/worker/jobs/recommended", wa.cookie], [`/employer/jobs/${matchJob.id}/candidates`, cookie]]) {
      const page = await request(path, undefined, actorCookie); assert.equal(page.status, 200); assert.match(await page.text(), /Mức độ phù hợp/);
    }
    await hiringPost(`jobs/${matchJob.id}/apply`, { creationKey: randomUUID(), matchScoreAtApply: 100 }, wa.cookie, 400);
    const matchApp = await hiringPost(`jobs/${matchJob.id}/apply`, { creationKey: randomUUID() }, wa.cookie);
    assert.ok(matchApp.matchAtApply); assert.equal(matchApp.matchAtApply.weightsVersion, "v1");
    assert.equal((await (await request(`${api}/worker-recommendations`, undefined, wa.cookie)).json()).items.some((item: { id: string }) => item.id === matchJob.id), false);
    assert.equal((await request(`${api}/worker/${candidateProfile.id}/discoverability`, { discoverable: false }, wa.cookie, "PATCH")).status, 200);
    assert.equal((await (await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, cookie)).json()).items.length, 0);
    assert.ok((await (await request(`${api}/employer-applications/${matchApp.id}`, undefined, cookie)).json()).worker);
    assert.equal((await request(`${api}/matching/${wa.id}/${matchJob.id}`, undefined, cookie)).status, 404);
    stage = "Phase 8 HTTP completed reviews, Company slot, privacy, visibility and v2";
    const workerReviewPath = `worker-engagements/${acceptedA.engagement.id}/reviews`;
    const employerReviewPath = `employer-engagements/${acceptedA.engagement.id}/reviews`;
    const reviewInput = { rating: 4, comment: "<script>review plain text</script>", creationKey: randomUUID() };
    const reviewForm = await request(`/worker/applications/${appA.id}`, undefined, wa.cookie);
    assert.match(await reviewForm.text(), /Gửi đánh giá/);
    await hiringPost(workerReviewPath, { ...reviewInput, reviewerUserId: userId }, wa.cookie, 400);
    await hiringPost(workerReviewPath, { ...reviewInput, rating: 2.5 }, wa.cookie, 400);
    await hiringPost(workerReviewPath, { ...reviewInput, comment: "\u200b" }, wa.cookie, 400);
    await hiringPost(workerReviewPath, reviewInput, wb.cookie, 404);
    await hiringPost(`worker-engagements/${acceptedB.engagement.id}/reviews`, reviewInput, wb.cookie, 409);
    const review = await hiringPost(workerReviewPath, reviewInput, wa.cookie);
    assert.equal((await hiringPost(workerReviewPath, reviewInput, wa.cookie)).id, review.id);
    await hiringPost(workerReviewPath, { ...reviewInput, rating: 5 }, wa.cookie, 409);
    await hiringPost(workerReviewPath, { ...reviewInput, creationKey: randomUUID() }, wa.cookie, 409);
    assert.equal((await request(`${api}/${workerReviewPath}`, reviewInput, wa.cookie, "PUT")).status, 404);
    assert.equal((await request(`${api}/${workerReviewPath}`, {}, wa.cookie, "DELETE")).status, 404);
    await hiringPost(employerReviewPath, { rating: 5, comment: null, creationKey: randomUUID() }, wm.cookie, 404);
    await db.companyMember.create({ data: { companyId: company.id, userId: wm.id, role: "MANAGER" } });
    await hiringPost(employerReviewPath, { rating: 5, comment: "Company verified work", creationKey: randomUUID() }, wm.cookie);
    await hiringPost(employerReviewPath, { rating: 3, comment: null, creationKey: randomUUID() }, cookie, 409);
    assert.equal((await request(`${api}/company/${company.id}/members/${wm.id}`, {}, cookie, "DELETE")).status, 200);
    assert.equal((await request(`${api}/${employerReviewPath}`, undefined, wm.cookie)).status, 404);
    const readOnlyPage = await (await request(`/worker/applications/${appA.id}`, undefined, wa.cookie)).text();
    assert.ok(readOnlyPage.includes("&lt;script&gt;review plain text&lt;/script&gt;")); assert.equal(readOnlyPage.includes("<script>review plain text</script>"), false);
    assert.equal(readOnlyPage.includes("Gửi đánh giá"), false);
    const reviewsJson = await (await request(`${api}/${workerReviewPath}`, undefined, wa.cookie)).json();
    for (const value of [wa.id, wm.id, userId!, wa.email, "reviewerUserId", "hiddenAt", "creationKey"]) assert.equal(JSON.stringify(reviewsJson).includes(value), false);
    const jobWithRating = await (await request(`${api}/jobs/${matchJob.id}`)).json();
    assert.equal(jobWithRating.reputation.rating.average, 4); assert.equal(jobWithRating.reputation.rating.count, 1);
    assert.equal((await request(`${api}/jobs/${matchJob.id}/reviews`)).status, 401);
    assert.equal((await request(`${api}/jobs/${matchJob.id}/reviews`, undefined, wa.cookie)).status, 200);
    assert.equal((await request(`${api}/jobs/${matchJob.id}/reviews?limit=31`, undefined, wa.cookie)).status, 400);
    const ownReputationPath = `${api}/workers/${candidateProfile.id}/reviews`;
    assert.equal((await request(ownReputationPath)).status, 401);
    assert.equal((await request(ownReputationPath, undefined, cookie)).status, 404);
    assert.equal((await request(`${api}/worker/${candidateProfile.id}/discoverability`, { discoverable: true }, wa.cookie, "PATCH")).status, 200);
    const reputationView = await (await request(ownReputationPath, undefined, cookie)).json();
    assert.equal(reputationView.reputation.rating.average, 5); assert.equal(reputationView.items.length, 1);
    const v2 = await (await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, cookie)).json();
    assert.equal(v2.items[0].match.algorithmVersion, "deterministic-v2");
    assert.equal(v2.items[0].match.components.find((c: { key: string }) => c.key === "rating").covered, true);
    assert.equal(v2.items[0].match.components.find((c: { key: string }) => c.key === "reliability").covered, true);
    assert.equal((await request(`/employer/workers/${candidateProfile.id}/reviews`, undefined, cookie)).status, 200);
    assert.equal((await request(`/worker/jobs/${matchJob.id}/reviews`, undefined, wa.cookie)).status, 200);
    assert.deepEqual((await (await request(`${api}/worker-applications/${matchApp.id}`, undefined, wa.cookie)).json()).matchAtApply, matchApp.matchAtApply);
    const deniedOriginReview = await fetch(`${origin}${api}/${workerReviewPath}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.invalid", Cookie: wa.cookie }, body: JSON.stringify(reviewInput) });
    assert.equal(deniedOriginReview.status, 403);
    stage = "Phase 9 real HTTP reports, cases, fresh ADMIN and audit";
    const adminApi = "/api/admin", decision = { reasonCode: "OTHER", reason: "HTTP reviewed fixture" };
    assert.equal((await request(`${adminApi}/cases`)).status, 401);
    assert.equal((await request(`${adminApi}/cases`, undefined, cookie)).status, 403);
    // Operational test fixture only: there is deliberately no public ADMIN grant API.
    await db.userRole.create({ data: { userId: wc.id, role: "ADMIN", grantedBy: "test-fixture" } });
    async function adminPost(path: string, body: object, expected = 200) {
      const response = await request(`${adminApi}/${path}`, body, wc.cookie);
      assert.equal(response.status, expected, `Admin ${path}`); return response.json();
    }
    const reportInput = { targetType: "JOB", targetId: matchJob.id, reasonCode: "SPAM", details: "<script>reported plain text</script>" };
    const report = await hiringPost("reports", reportInput, wa.cookie);
    const userReport = await hiringPost(`employer-applications/${appA.id}/report-counterparty`, { reasonCode: "HARASSMENT", details: null }, cookie);
    assert.equal(userReport.targetType, "USER"); assert.equal(userReport.targetId, null);
    const companyReport = await hiringPost(`worker-applications/${appA.id}/report-counterparty`, { reasonCode: "SCAM", details: null }, wa.cookie);
    assert.equal(companyReport.targetType, "COMPANY");
    await hiringPost(`worker-applications/${appA.id}/report-counterparty`, { reasonCode: "SPAM", details: null }, wb.cookie, 404);
    await hiringPost(`employer-applications/${appA.id}/report-counterparty`, { reasonCode: "SPAM", details: null, targetId: wb.id }, cookie, 400);
    assert.equal((await request(`/reports/new?applicationId=${appA.id}&side=EMPLOYER`, undefined, cookie)).status, 200);
    assert.equal((await hiringPost("reports", reportInput, wa.cookie)).id, report.id);
    for (const field of ["details", "reporterUserId", "resolutionNote", wa.email]) assert.equal(JSON.stringify(report).includes(field), false);
    await hiringPost("reports", { ...reportInput, reporterUserId: wb.id }, wa.cookie, 400);
    await hiringPost("reports", { targetType: "MESSAGE", targetId: employerMessage.id, reasonCode: "HARASSMENT", details: null }, wb.cookie, 404);
    const messageReport = await hiringPost("reports", { targetType: "MESSAGE", targetId: employerMessage.id, reasonCode: "HARASSMENT", details: null }, wa.cookie);
    const messageCase = await adminPost("cases", { ...decision, targetType: "MESSAGE", targetId: employerMessage.id, severity: "HIGH", reportId: messageReport.id });
    const singleContext = await adminPost(`cases/${messageCase.id}/context`, decision);
    assert.equal(singleContext.id, employerMessage.id); assert.equal("messages" in singleContext, false);
    const jc = await adminPost("cases", { ...decision, targetType: "JOB", targetId: matchJob.id, severity: "HIGH", reportId: report.id });
    await adminPost(`cases/${jc.id}/investigate`, decision);
    await adminPost(`cases/${jc.id}/actions/hide-job`, { ...decision, targetId: companyJob.id }, 409);
    const deniedOriginAdmin = await fetch(`${origin}${adminApi}/cases/${jc.id}/actions/hide-job`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.invalid", Cookie: wc.cookie }, body: JSON.stringify({ ...decision, targetId: matchJob.id }) });
    assert.equal(deniedOriginAdmin.status, 403);
    await adminPost(`cases/${jc.id}/actions/hide-job`, { ...decision, targetId: matchJob.id, adminUserId: wc.id }, 400);
    await adminPost(`cases/${jc.id}/actions/hide-job`, { ...decision, targetId: matchJob.id });
    assert.equal((await request(`${api}/jobs/${matchJob.id}`)).status, 404);
    await hiringPost(`jobs/${matchJob.id}/apply`, { creationKey: randomUUID() }, wb.cookie, 409);
    assert.equal((await request(`${jobsPath}/${matchJob.id}/candidates`, undefined, cookie)).status, 409);
    await adminPost(`cases/${jc.id}/actions/unhide-job`, { ...decision, targetId: matchJob.id });
    assert.equal((await request(`${api}/jobs/${matchJob.id}`)).status, 200);
    const rr = await hiringPost("reports", { targetType: "REVIEW", targetId: review.id, reasonCode: "SPAM", details: null }, wa.cookie);
    const rc = await adminPost("cases", { ...decision, targetType: "REVIEW", targetId: review.id, severity: "MEDIUM", reportId: rr.id });
    await adminPost(`cases/${rc.id}/actions/hide-review`, { ...decision, targetId: review.id });
    assert.equal((await (await request(`${api}/jobs/${matchJob.id}`)).json()).reputation.rating.count, 0);
    await adminPost(`cases/${rc.id}/actions/unhide-review`, { ...decision, targetId: review.id });
    assert.equal((await (await request(`${api}/jobs/${matchJob.id}`)).json()).reputation.rating.count, 1);
    for (const path of ["/admin/cases", "/admin/reports", `/admin/cases/${jc.id}`, "/account/reports", `/reports/new?targetType=JOB&targetId=${matchJob.id}`]) {
      const page = await request(path, undefined, path.startsWith("/admin") ? wc.cookie : wa.cookie);
      assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
      assert.equal((await page.text()).includes("<script>reported plain text</script>"), false);
    }
    const auditPage = await request(`${adminApi}/cases/${jc.id}/audit?limit=2`, undefined, wc.cookie);
    assert.equal(auditPage.status, 200); const auditJson = await auditPage.json(); assert.equal(auditJson.items.length, 2); assert(auditJson.nextCursor);
    assert.equal((await request(`${adminApi}/cases/${jc.id}/audit?limit=51`, undefined, wc.cookie)).status, 400);
    await adminPost(`cases/${jc.id}/close`, { ...decision, resolutionCode: "RESOLVED" });
    await adminPost(`cases/${jc.id}/actions/hide-job`, { ...decision, targetId: matchJob.id }, 409);
    assert.equal((await (await request(`${api}/reports`, undefined, wa.cookie)).json()).items.find((item: { id: string }) => item.id === report.id).status, "RESOLVED");
    stage = "Phase 9 HTTP forced lifecycle and immutable snapshots";
    const forceJob = await moveHttpJob(await createHttpJob(company.id), "publish");
    await db.rateLimit.upsert({ where: { key: `report:user:${wc.id}` }, create: { id: randomUUID(), key: `report:user:${wc.id}`, count: 10, lastRequest: BigInt(Date.now()) }, update: { count: 10, lastRequest: BigInt(Date.now()) } });
    await hiringPost("reports", { targetType: "JOB", targetId: forceJob.id, reasonCode: "SPAM", details: null }, wc.cookie, 429);
    async function forceFixture(worker: { cookie: string }) {
      const application = await hiringPost(`jobs/${forceJob.id}/apply`, { creationKey: randomUUID() }, worker.cookie);
      await hiringPost(`employer-applications/${application.id}/shortlist`, {}, cookie);
      const offer = await hiringPost(`employer-applications/${application.id}/offers`, { creationKey: randomUUID(), expiresAt: null }, cookie);
      const accepted = await hiringPost(`offers/${offer.id}/accept`, {}, worker.cookie);
      return { application, engagement: accepted.engagement };
    }
    const fa = await forceFixture(wa), fb = await forceFixture(wb);
    const frozenForce = await db.engagement.findUniqueOrThrow({ where: { id: fa.engagement.id } });
    const fc = await adminPost("cases", { ...decision, targetType: "ENGAGEMENT", targetId: fa.engagement.id, severity: "HIGH" });
    await adminPost(`cases/${fc.id}/actions/force-complete`, { ...decision, targetId: fa.engagement.id }, 409);
    await hiringPost(`employer-engagements/${fa.engagement.id}/start`, {}, cookie);
    const forceChat = await hiringPost(`worker-applications/${fa.application.id}/conversation`, {}, wa.cookie);
    await adminPost(`cases/${fc.id}/actions/force-complete`, { ...decision, targetId: fa.engagement.id });
    const completedForce = await db.engagement.findUniqueOrThrow({ where: { id: fa.engagement.id } });
    assert.equal(completedForce.status, "COMPLETED"); assert.equal(completedForce.completionRequestedAt, null); assert.deepEqual(completedForce.terms, frozenForce.terms);
    await hiringPost(`worker-conversations/${forceChat.id}/messages`, { body: "Terminal denied", creationKey: randomUUID() }, wa.cookie, 403);
    const cancelCase = await adminPost("cases", { ...decision, targetType: "ENGAGEMENT", targetId: fb.engagement.id, severity: "HIGH" });
    await adminPost(`cases/${cancelCase.id}/actions/force-cancel`, { ...decision, targetId: fb.engagement.id });
    assert.equal((await db.engagement.findUniqueOrThrow({ where: { id: fb.engagement.id } })).cancelledBy, null);
    await adminPost(`cases/${cancelCase.id}/actions/force-complete`, { ...decision, targetId: fb.engagement.id }, 409);
    stage = "Phase 9 HTTP account restrictions";
    const uc = await adminPost("cases", { ...decision, targetType: "USER", targetId: wm.id, severity: "HIGH" });
    await adminPost(`cases/${uc.id}/actions/suspend`, { ...decision, targetId: wm.id });
    assert.equal((await request(`${api}/worker-recommendations`, undefined, wm.cookie)).status, 403);
    await adminPost(`cases/${uc.id}/actions/unsuspend`, { ...decision, targetId: wm.id });
    await adminPost(`cases/${uc.id}/actions/ban`, { ...decision, targetId: wm.id });
    assert.equal((await request(`${api}/worker`, undefined, wm.cookie)).status, 403);
    await adminPost(`cases/${uc.id}/actions/unsuspend`, { ...decision, targetId: wm.id }, 409);
    await db.userRole.delete({ where: { userId_role: { userId: wc.id, role: "ADMIN" } } });
    assert.equal((await request(`${adminApi}/cases`, undefined, wc.cookie)).status, 403);
    await db.userRole.create({ data: { userId: wc.id, role: "ADMIN", grantedBy: "test-fixture" } });
    await db.user.update({ where: { id: wc.id }, data: { status: "SUSPENDED" } });
    assert.equal((await request(`${adminApi}/cases`, undefined, wc.cookie)).status, 403);
    await db.user.update({ where: { id: wc.id }, data: { status: "ACTIVE" } });
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
    console.info("PASS: real Next HTTP Phase 2–8 regressions and Phase 9 reports/privacy/case binding/fresh ADMIN/audit/hide/unhide/forced lifecycle/status/UI/origin/XSS; PostgreSQL and test-only intercepted mail.");
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
        await cleanupModerationFixtures(db, [userId, ...hiringUsers]);
        const jobIds = (await db.job.findMany({ where: { createdByUserId: userId }, select: { id: true } })).map((item) => item.id);
        const chatIds = (await db.conversation.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } })).map((item) => item.id);
        await db.notification.deleteMany({ where: { conversationId: { in: chatIds } } }); await db.conversationReadState.deleteMany({ where: { conversationId: { in: chatIds } } });
        await db.message.deleteMany({ where: { conversationId: { in: chatIds } } }); await db.conversation.deleteMany({ where: { id: { in: chatIds } } });
        const chatUsers = [userId, ...hiringUsers];
        await db.userBlock.deleteMany({ where: { OR: [{ blockerUserId: { in: chatUsers } }, { blockedUserId: { in: chatUsers } }] } });
        await db.rateLimit.deleteMany({ where: { OR: chatUsers.flatMap((id) => [{ key: `message:user:${id}` }, { key: { startsWith: `message:conversation:${id}:` } }]) } });
        await db.review.deleteMany({ where: { engagement: { jobId: { in: jobIds } } } });
        await db.engagement.deleteMany({ where: { jobId: { in: jobIds } } });
        await db.offer.deleteMany({ where: { jobId: { in: jobIds } } });
        await db.application.deleteMany({ where: { jobId: { in: jobIds } } });
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
      await db.workerProfile.deleteMany({ where: { userId: { in: hiringUsers } } });
      await db.employerProfile.deleteMany({ where: { userId: { in: hiringUsers } } });
      await db.verification.deleteMany({ where: { value: { in: hiringUsers } } });
      await db.userRole.deleteMany({ where: { userId: { in: hiringUsers } } });
      await db.user.deleteMany({ where: { id: { in: hiringUsers } } });
      await db.rateLimit.deleteMany({ where: { OR: ratePrefixes.map((prefix) => ({ key: { startsWith: prefix } })) } });
      await db.$disconnect();
    } catch { console.error("FAIL: HTTP fixture cleanup failed; sensitive diagnostics suppressed."); process.exitCode = 1; }
  }
}
