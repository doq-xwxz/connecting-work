# Production runbook — Phase 12

Status: **BLOCKED — USER ACTION REQUIRED**. Repository preparation is separate from a public release. No production account/project, database, migration, email delivery, backup or URL has been verified. The user confirmed the connected Vercel team is not theirs; do not use that team. No paid service or domain purchase is authorized. Stop at Phase 12.

## Ownership and architecture

Intended: user-owned Vercel Next.js Node 24 project, managed PostgreSQL 18 UTF8 (Neon is a candidate), Resend auth mail. All sessions, rate budgets, marketplace history and audit live in PostgreSQL. No PC worker, Redis, object storage, WebSocket, cron or uploaded documents are required. Optional external analytics/error reporting remains Noop; PostgreSQL is authoritative for KPIs.

Before provisioning record the actual account/project IDs, free/paid plan, region, connection limit, backup capability and owner in the private operations record. Choose hosting and DB regions together after the user reviews data residency. Do not invent a region, retention period, restore success or operational owner. Never provision in the unrelated connected team. Reconnect Vercel to the user's own account and confirm the intended personal project before any write.

## Configuration inventory (names only)

| Name | Placement / purpose |
|---|---|
| DATABASE_URL | Production Secret; provider pooled runtime PostgreSQL URL, verified TLS |
| DIRECT_DATABASE_URL | Controlled release environment Secret; direct migration endpoint; not needed by serving functions |
| APP_URL | Production Config; exact stable public HTTPS origin, no path/query/fragment |
| BETTER_AUTH_URL | Optional Config; same origin as APP_URL |
| BETTER_AUTH_SECRET | Production Secret; independently generated cryptographic random value, at least 32 characters |
| EMAIL_PROVIDER | Production Config; resend |
| RESEND_API_KEY | Production Secret; sending permission scoped to the verified domain where supported |
| EMAIL_FROM | Production Config; real verified sender |
| ENABLE_EXPERIMENTAL_COREPACK | Hosting build Config; 1, selects packageManager pnpm 11.25.0 |
| ENABLE_HSTS | Build Config; optional 1 only after stable HTTPS verification |
| NEXT_TELEMETRY_DISABLED | Optional build Config; 1 |
| NODE_ENV | Managed runtime; production, not an application secret |

No R2/PostHog/Sentry key is currently consumed by runtime. No NEXT_PUBLIC secret. Never install TEST_DATABASE_URL, AUTH_TEST_DATABASE, AUTH_HTTP_TEST, test inbox settings or a NODE_OPTIONS mail preload in production. CI's disposable credentials must never be copied to hosting. Preview uses a separate origin, DB and secrets; leave automatic previews disabled until that isolation exists. Local `.env*`, `.vercel`, generated Prisma, builds and logs are ignored. Do not print or upload them as CI artifacts.

Generate the auth secret inside a trusted secret-handling process and write it directly into the provider secret manager; do not echo it or place it in command arguments. Keep the DB direct URL in the release job's secret store. Type Secret may not be readable through env pull; verify names and use the controlled migration runner, never downgrade secrets for convenience. Access must remain recoverable by the user.

## Hosting settings and release gate

Import `doq-xwxz/connecting-work` into the correct user account, root `.`, production branch `main`, Next.js, Node 24.x. `vercel.json` pins framework, frozen Corepack/pnpm installation and `pnpm build` (which generates Prisma). Build/start never run migration or seed. Confirm actual build logs show pnpm 11.25.0 and Node 24; a successful local build does not prove Vercel's build image. Source/build logs remain private (`public:false`); no public browser source maps are enabled.

Automatic Git deployments are disabled for all branches until a controlled release and isolated preview configuration exist. Manual deployment of a reviewed exact Git SHA is allowed under the user's Phase 12 authorization. Do not enable automatic main promotion before checks and migration gates are configured. No secret-bearing workflow is added to pull requests. CI GitHub permissions remain read-only; database writes target disposable PostgreSQL only.

Required sequence:

1. Freeze an exact main SHA; verify both Repository checks jobs and every required step succeeded on that SHA. `git ls-remote origin refs/heads/main` must match the reviewed release. No force push.
2. Confirm correct managed accounts, region/plan/connection budget, backup window and restore owner; complete a nonproduction restore drill where available.
3. Configure exact HTTPS origin, runtime secrets and verified sender. Keep previews isolated/disabled. Review privacy/retention and incident ownership before public intake.
4. Run controlled committed migration deploy using the direct connection, then status and read-only release verification. Capture names/status/time, no URLs/credentials.
5. Stage a production-target build without assigning the public alias; verify provider deployment metadata's full Git SHA matches the frozen SHA. For an authenticated CLI linked to the verified project: `vercel deploy --prod --skip-domain`. Use the exact clean checkout; no ignored credentials in deploy source. Prefer Git-SHA API deployment when available.
6. Verify staged health/readiness and real mail/auth on the configured origin; alias/origin configuration must agree. Promote the tested production build using the provider's controlled promotion flow when appropriate. A preview promotion may rebuild with different env; verify the actual promoted SHA/build.
7. Run the public controlled marketplace/admin smoke below and privacy/header checks, then record URL, deployment ID/full SHA/UTC time, migration receipt and alert routing.
8. Stop task-owned local processes and repeat public probes from outside those processes. Only after all launch gates pass mark Phase 12 PASS.

For the first release there is no previous known-good public deployment. On failed acceptance keep public intake closed; repair or remove the public alias using the provider control plane. A successful build alone is not a released marketplace.

## PostgreSQL compatibility, pooling and least privilege

Provider must support PostgreSQL 18+, UTF8 and `pg_catalog.pg_unicode_fast`, required by immutable Phase 6 FTS SQL. Confirm `SHOW server_version_num`, `SHOW server_encoding` and the collation catalog before migrations. Neon documents PG18 availability, but no Neon account/resource has been selected or verified here.

Use the provider's pooled endpoint for runtime, direct endpoint for Prisma migrations/operational verification. Keep certificate verification and hostname validation enabled; never use rejectUnauthorized:false, NODE_TLS_REJECT_UNAUTHORIZED=0 or a no-verify SSL mode. For pg/libpq use provider-recommended verify-full configuration (Neon also recommends channel binding); verify an actual encrypted connection and successful pooled transaction against the selected provider. Do not infer TLS from a hostname alone. The local disposable check does not certify cloud TLS/pool behavior.

Runtime pool max5 is per instance, connect5s/idle30s/statement10s/idle transaction20s. Size concurrent instances × pool capacity against the actual provider connection budget. Do not guess a global safe limit or auto-upgrade billing. Interactive transactions/advisory locks are transaction-scoped; verify the pooled endpoint supports the implemented transaction path. No application-level prepared-statement/pool workaround is currently justified.

Separate migration owner from runtime role where provider permits. Runtime needs schema usage/table DML and required functions, not schema ownership/DDL/superuser or trigger disabling. Review grants in staging against full flows; migration owner retains SQL DDL rights. The SQL guards are not protection from a privileged database owner. Do not revoke necessary application access blindly on the first release.

## Migration review and execution

All ten historical migrations were read; none changed. Chain: foundation infrastructure probe; auth; remove only FoundationCheck; profiles/company + ten Skills; Jobs; hiring immutable history; generated Unicode FTS/immutable apply facts; messaging/history; reviews/completed participant guard; moderation/audit/effect constraints. Final schema has no FoundationCheck. Historical DROP operations remove that obsolete table and replace an FTS index/review trigger/lifecycle constraint; they do not delete marketplace history. SQL-owned CHECK/partial indexes/triggers are not fully represented by Prisma and must remain.

Before running, inspect provider DB identity/version/encoding and `_prisma_migrations` if present. Confirm there is no unresolved failed attempt, concurrent migration runner or unexpected existing schema. Capture provider backup/restore point and a private change reference. Rehearse on a separate disposable database using the exact committed chain and current dependencies.

In a controlled release environment with secret-injected direct URL and no shell tracing:

```text
pnpm install --frozen-lockfile
pnpm db:validate
pnpm db:deploy
pnpm db:status
pnpm db:release-check
```

`db:release-check` is operator-only READ ONLY: PG18/UTF8/collation, committed SQL checksums in migration history, ten active taxonomy slugs and required valid indexes/enabled history guards. It prints static status only. It does not test every privilege/policy or certify TLS/backups. `db:smoke` creates a rolled-back transient User; use it only for disposable validation here. Never run integration suites or arbitrary seeds on production. No db push/reset/migrate dev/shadow DB against production.

On migration failure stop release immediately. Preserve prior application if compatible, inspect restricted provider/Prisma history and actual committed schema with the operator, assess locks/partial DDL and recovery point. Do not blindly rerun or mark resolved. `migrate resolve` requires an independently reviewed exact repair/baseline decision after proving schema state; never edit applied migration SQL. Prefer forward additive repair. Capture only safe migration names/status in public evidence; restricted logs may themselves contain sensitive connection context.

## Backup and restore

Actual configured capability/window/last backup/restore result: **unverified, launch blocked**. Published plan features are not evidence that a project has backups. Neon currently documents plan-dependent instant restore windows; confirm the actual chosen plan's time/storage limits and billing in the user's console. Do not silently buy a longer window. Agree RPO/RTO and owner before launch rather than invent targets.

Record encryption/access, region, restore window/quota and expiry privately. In a nonproduction branch/database create a known harmless marker, record its time, restore/branch from a preceding point using the provider's Instant restore/branch UI, verify expected marker state plus migration history/checksums, ten Skills and Unicode FTS/history constraints. Run full disposable suites only if the restored database meets test guards and contains no production PII. A production-data restore gets restricted read-only validation and controlled smoke, never destructive integration cleanup.

Keep original DB intact while validating the restored target. Record provider operation ID/time/outcome, not connection strings. During real recovery freeze writes, reconcile writes after restore point, test the recovered schema/app, switch runtime secret to the new verified pooled URL and redeploy deliberately. Prevent two writable primaries. Restore can lose later audit/transaction history; owner must approve reconciliation. Encrypted export only through an approved managed backup location with reviewed retention/access; no plaintext backup on a developer PC. No restore drill has run against a real provider in this task.

## Real mail, auth and ADMIN bootstrap

User supplies an owned sending domain and DNS access (no purchase assumed). In Resend verify required SPF/DKIM/provider records and sender status; store a scoped API key in hosting Secret. Use operator-controlled recipient accounts, real HTTPS links and distinct Worker/Employer identities. Confirm signup receives email, fragment confirmation POST succeeds, login creates Secure/HttpOnly/SameSite=Lax host cookie, logout invalidates session, reset email works/one-time token expires and old sessions are revoked. Never copy links/tokens/passwords/cookies into logs, screenshots or this report. Provider delivered status alone does not prove inbox receipt/link completion.

For ADMIN use a separate intended identity created and verified through normal signup. Review exact User ID and private operator/change ticket. Inside a bound transaction take User NO KEY UPDATE, recheck ACTIVE/emailVerified, insert the ADMIN role idempotently with grantedBy set to the reviewed change reference. Independent operator review and retained private approval are required. No public role-grant API, temporary bootstrap endpoint, committed password or sample admin account. Confirm real ADMIN page/API succeeds and normal/stale/suspended ADMIN is denied. Revocation is an equally reviewed direct operational role removal. Keep the runtime role unable to grant itself operational privileges via untrusted routes.

## Controlled public smoke and evidence

Use real API/UI workflows on clearly labeled operator smoke resources. Do not import disposable harnesses into production, bypass verification, set test flags or seed fixture SQL. Record only opaque resource IDs, action/result/time in the restricted receipt; screenshots must exclude personal data and token fragments.

1. Anonymous HTTPS landing, Jobs FTS/filter/details with safe DTO; logged-out private routes denied and errors static.
2. Verified Worker activates role and creates skills/preferences/minimum complete profile; discovery stays off unless explicitly needed. Distinct verified Employer activates role/profile, drafts and publishes one clearly labeled smoke Job.
3. Recommendations show **Mức độ phù hợp**, coverage and advisory meaning, never hiring probability. Apply is checked by normal service, Employer view/shortlist/new Offer, Worker acceptance creates one Engagement.
4. Open contextual conversation, exchange messages while eligible, poll/read/unread/notification behavior. Employer starts, Worker requests completion, Employer confirms; organic completed count changes once. Terminal work leaves chat read-only.
5. Both legitimate sides submit one immutable review; sample counts/visible aggregates update, no contacts/hidden metadata leak.
6. Report one smoke Job/review, intended ADMIN opens bound case, hide/unhide and close with valid reason; immutable audit records remain. Never ban/suspend real users. Any optional forced-work test needs a separate dedicated legitimate smoke Engagement/case and must be reported as forced.
7. ADMIN bounded UTC analytics shows domain counts/organic-versus-forced and safe zero immature liquidity denominator; never fabricate a 24h cohort or backdate rows. No provider events as KPI authority.
8. Close smoke Job through owner action to remove public exposure, complete when eligible; retain all actual application/offer/engagement/chat/review/audit history. No SQL cleanup bypass.

Check health200 `{status:"ok"}`, ready200 `{status:"ready"}`; both no-store/no secrets. Inspect CSP (no production unsafe-eval), nosniff/DENY/referrer/Permissions-Policy, exact-origin write rejection and valid-origin success behind proxy, Secure cookies and no shared CDN private cache. `X-Robots-Tag:noindex,nofollow` covers private/API/auth paths and robots disallows crawling them; robots is not authorization. Verify no browser secret/source maps or sensitive response/log contents. User-authored public text is not automatically PII-redacted. HSTS opt-in is build-time after verified stable HTTPS, one-year/no preload/no subdomains; platform-provided HSTS must also be inspected.

Verify public availability from an independent network after stopping only task-owned local Next/PostgreSQL processes. Do not shut down unrelated apps or the user's PC. Record URL/full deployment SHA/time plus health/readiness/anonymous Job/real auth results; no claim of PC independence from architecture alone.

## Monitoring, incident response and rotation

Hosted Vercel deployment/runtime logs and managed DB monitoring are the minimum intended operational tools; actual access and retention/alert routing remain unconfigured. Assign a primary and backup owner and a real contact/channel privately. Configure hosted external uptime health/ready probes if available without unapproved cost; probes must not depend on this PC. Review measured latency/error/readiness/auth-abuse baselines before assigning environment-specific thresholds. No invented SLA or configured-alert claim.

Sentry/PostHog are optional and deferred: runtime currently uses immutable Noop providers. Enabling them requires explicit server adapter, pseudonymous identity/export policy, region/consent/retention review, strict property projection and cooperative abort. No autocapture, replay, cookies, PII, original exception stack/cause/SQL or token-page instrumentation. Current domain metrics do not depend on external delivery. Never expose a monitoring debug endpoint.

Incident order: check hosting deployment/alias/current SHA, then health versus readiness, provider DB availability/connection budget/TLS and migration status, then safe runtime error rate. Inspect restricted logs without copying payloads/tokens/URLs. For email failures inspect Resend verified domain/DNS, sending permission/config names and provider delivery result; do not weaken verification or log links. For DB failure return safe503/INTERNAL; never fall back to local DB or memory. Hold new release and involve the actual owner. Record only static incident metadata in public docs; business audit remains intact.

Rotate auth secret via provider Secret and controlled redeploy; assess/revoke existing sessions and signed verification links as appropriate, warn users through an approved channel. Rotate DB credentials in provider, validate the new direct/pooled URLs, atomically update runtime/release stores, redeploy and revoke old credentials after validation. Rotate Resend key similarly and verify real mail. Rotate optional monitoring keys only if configured. Do not retain plaintext old keys or URL backups. Use provider recovery/access controls and restrict deployment/source/log visibility.

## Rollback and repository protection

Record the previous known-good **deployment ID/full SHA** and its compatible schema before every future release. Provider UI Deployments → selected known-good production build → Rollback, or authenticated linked CLI `vercel rollback <known-good-deployment-url-or-id>`. Verify alias/full SHA, health/ready/auth/public Jobs afterward. Vercel rollback disables automatic production assignment until promotion; keep controlled release gates. Do not git-reset/force-push or run down/reset/drop migrations. A new schema must remain compatible with the previous application; otherwise hold traffic and use a reviewed forward fix/restore procedure. The first release has no known-good rollback; record this risk.

Where repository permission allows, protect main with both checks/postgres-auth required, block force pushes/deletion and retain an owner recovery path. Confirm the actual check names and user access before changing settings; mandatory PR review is a user preference, not assumed. Current token/connector permissions have not been verified for these settings. Recommended protection is not claimed active.

## D4 / D7 minimum launch review

Phase 12 request keeps phone optional/no SMS and company badge optional, with verified email required for recruiting. No new identity documents/payment/AI/upload. Before real public intake the owner must review jurisdiction/data region, privacy notice/consent and legal retention/deletion process. Do not invent legal compliance or periods.

Inventory: identity/email/password hash and auth session/verification data; private structured profiles/preferences/availability; Company/member history; public Jobs; private applications/immutable offers/work; private messages/block/read/inbox; reviews; reports/cases/immutable audit; rate keys and pseudonymous telemetry contract. No raw analytics store, file uploads or payment data. Restrict operator/backup access. Logs exclude message/review/report text, auth values, SQL and contact PII. A controlled verified-request process must assign privacy owner, identity verification, legal hold/history constraints, export/redaction/anonymization review and backup-restoration reconciliation. No blanket cascading deletes or unsupported automatic deletion API. Unresolved legal/retention/data-residency obligations are a launch blocker.

## Sources checked for provider guidance

[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration), [build/Corepack](https://vercel.com/docs/builds/configure-a-build), [deployment promotion](https://vercel.com/docs/deployments/promoting-a-deployment), [Neon PG18](https://neon.com/blog/postgres-18), [Neon restore window](https://neon.com/docs/introduction/restore-window), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction). These document platform capabilities; actual account configuration/evidence is still required.
