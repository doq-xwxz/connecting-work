# Connecting Work

Phase 11 adds `/admin/analytics` and GET `/api/admin/analytics?start=<UTC ISO>&end=<UTC ISO>` for fresh ACTIVE ADMIN only. Maximum366 days; end exclusive. Default page shows30 UTC days. North Star is completed Engagements, with organic/admin-forced breakdown. Liquidity measures3 relevant immutable at-apply snapshots in the first 24h for fully observed first-publication cohorts; early-zero-application cancellation policy and funnel definitions are in [PHASE_11](PHASE_11.md).

`GET /api/health` is provider-independent liveness; `GET /api/ready` checks PostgreSQL and returns minimal503 when unavailable. No PostHog/Sentry credentials or SDK are required: provider-neutral interfaces default to Noop, server-side only. No autocapture/replay/PII/event table/outbox. Production adapters and alert delivery remain separate operational work; no deployment occurs.

Run `pnpm test:analytics` on the same explicit disposable PostgreSQL after prior regression suites and before HTTP. CI includes it. `pnpm test:production` additionally exercises production health/readiness with healthy/unreachable DBs. All existing test isolation/credential restrictions apply. Phases 0–11 are approved. Phase 12 production readiness and public deployment are authorized; current provider blockers and evidence are in PHASE_12.md. Stop at Phase 12.

Tìm đúng việc. Gặp đúng người.

Phase 10 hardens the approved Phase 0–9 marketplace: strict request/text boundaries, persisted atomic rate budgets, safe errors, bounded transaction retries, security headers and PostgreSQL/HTTP/production-build verification. [PRODUCT.md](PRODUCT.md) remains source of truth; [PHASE_0.md](PHASE_0.md) records approved decisions. See [PHASE_10.md](PHASE_10.md) for findings, evidence and remaining operational risks. This Phase 10 paragraph is historical; Phase 12 status is authoritative above.

## Documentation

[AGENTS](AGENTS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [ROADMAP](ROADMAP.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [Phase 1 historical report](PHASE_1.md) · [Phase 2 evidence](PHASE_2.md) · [Phase 3 historical review](PHASE_3.md) · [Phase 4 historical review](PHASE_4.md) · [Phase 5 historical review](PHASE_5.md) · [Phase 6 historical review](PHASE_6.md) · [Phase 7 historical review](PHASE_7.md) · [Phase 8 historical review](PHASE_8.md) · [Phase 9 historical review](PHASE_9.md) · [Phase 10 review](PHASE_10.md)

## Local setup

Phase 9: use `/account/reports` for private receipts and report links on Jobs/Reviews/Messages/Engagements/Application counterparties. Trusted ACTIVE ADMIN uses `/admin/cases` and `/admin/reports`; every action requires a case bound to the exact resource and a reason. Hidden Jobs block new recruitment/acceptance; suspended active obligations remain scoped, banned marketplace access fails closed. Run `pnpm test:moderation` on the documented disposable PostgreSQL for moderation, observed lock races and populated Phase 8→9 upgrade rehearsal. See [PHASE_9](PHASE_9.md) for exact D5 decisions and limits.

Use Node 24 (tested version in `.node-version`) and pnpm 11.25.0 (`packageManager`). Install pnpm through your approved runtime/package-manager setup if missing; no second lockfile/package manager.

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Open http://127.0.0.1:3000. Landing/auth pages and build need no runtime credentials; real Job data needs migrated PostgreSQL. For working auth, configure ignored .env.local or hosting env: DATABASE_URL, APP_URL, BETTER_AUTH_SECRET, EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM. BETTER_AUTH_URL is optional and must match APP_URL if supplied; DIRECT_DATABASE_URL optionally selects an unpooled migration endpoint. Apply committed migrations before using auth. No real secrets are supplied. Missing auth/provider config fails safely when used. No SQLite or infrastructure provisioning. See [DATABASE](DATABASE.md) and [SECURITY](SECURITY.md).

Routes: /sign-up, /sign-in, /verify-email, /forgot-password, /reset-password and protected /account. Verify email before sign-in; choose one/both normal roles on account after login. ADMIN is trusted operational provisioning only, never a form option. Verification/reset mail links use fragments and POST confirmation; do not copy tokens into logs/issues. For manual local tests, use a sender and recipient controlled by the operator. Automated tests use a fake email provider, never real email.

Staging/production: set an explicit HTTPS APP_URL, a random secret of at least 32 characters, managed PostgreSQL with verified TLS/provider pooling, and configured email sender. Preview branches need their own explicit origin, isolated database and secrets; no automatic trust of arbitrary Vercel hosts. Managed hosts inject env. pnpm start respects managed PORT/binding defaults; only pnpm dev intentionally binds loopback. No identity/session data lives on the operator's filesystem or in process memory. On Vercel use the Node runtime, align DB region and verify trusted proxy IP/rate-limit behavior. Email work uses Next after, which the managed Next host must support. Actual deployment is separately evidenced in PHASE_12.md; repository compatibility alone is not a deployed site.

## Checks

After login and role activation, use `/worker/profile` (also `/edit`) for your WorkerProfile and discoverability toggle, `/employer/profile` (also `/edit`) for your personal EmployerProfile, `/employer/workers` for private discovery, and `/employer/companies`, `/new`, `/[companySlug]` for current company membership. Create an EmployerProfile before discovery/company creation. Worker discoverability defaults off. OWNER can inspect members/remove MANAGER; MANAGER can edit company details. No member-add/invitation/ownership-transfer, upload or company-verification action exists.

```text
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Typecheck/build generate the Prisma client first; typecheck also runs Next typegen so a clean checkout does not require prior dev/build output. `pnpm db:smoke` reports BLOCKED (exit 2) without DATABASE_URL; it is a database integration probe, not a fake passing unit test. `pnpm db:migrate --name <change>` creates/applies development migrations; `pnpm db:deploy` only applies committed SQL to an operator-selected database. These commands do not deploy the website. Never reset shared/production data.

CI runs frozen install, schema validation, lint, typecheck, unit tests and build, plus a fresh PostgreSQL 18 service for committed migrations, DB smoke, `pnpm test:integration`, `pnpm test:profiles`, `pnpm test:jobs`, `pnpm test:hiring`, `pnpm test:matching`, `pnpm test:messaging`, `pnpm test:reviews`, `pnpm test:moderation`, and `pnpm test:http` (actual Next Phase 2–9 routes/pages). All nine integration commands require explicit TEST_DATABASE_URL, AUTH_TEST_DATABASE=disposable and applied migrations on that dedicated PostgreSQL DB. Scope DATABASE_URL/DIRECT_DATABASE_URL to the same disposable endpoint for migration/smoke commands; never use production. Tests clean only their own fixtures. The HTTP child starts/stops automatically and intercepts only email transport. No browser E2E dependency, deployment or production/provider secret was added. See PHASE_10 for current evidence; earlier reports remain historical.

## Jobs (Phase 4)

Anonymous `/jobs` and `/jobs/[jobId]` show PUBLISHED ads only. Current Employers use `/employer/jobs`, `/new`, `/[jobId]`, `/[jobId]/edit`; an EmployerProfile is required. Choose personal ownership or a company you currently manage. Save DRAFT first, then publish after validation and verified email. Each personal profile/company has three PUBLISHED+PAUSED slots; pausing does not free a slot. CLOSED never reopens: duplicate to a fresh DRAFT. Phase 5 adds Apply and an explicit CLOSED→COMPLETED action after work obligations finish.

Public APIs are GET `/api/marketplace/jobs` and `/jobs/:id`; private Job APIs use `/api/marketplace/employer-jobs`, PUT `/:id`, and POST `/:id/publish|pause|resume|close|cancel|complete|duplicate`. Client forms send explicit structured fields and optimistic expectedVersion. Public filters include q/city/employmentType/workMode/category/skillId and compensation unit/range, with a bounded filter-bound cursor/default 12/max 30. Unknown/duplicate filters fail safely. Compensation is an exact whole-VND string range; schedule uses recurring local whole hours; dates are date-only. No exact workplace address is stored.

Run `pnpm test:jobs` then `pnpm test:hiring` before `test:http` on the documented disposable PostgreSQL. Jobs/hiring need migrated runtime PostgreSQL; production build and landing remain credential-free. No operator-PC process is needed in production. The first Application now activates material edit restrictions from real rows; description wording remains editable. See PHASE_5 for evidence.

## Hiring (Phase 5)

Workers use `/worker/applications` and `/worker/applications/[applicationId]`; Employers use `/employer/jobs/[jobId]/applications` and `/employer/applications/[applicationId]`. Apply requires ACTIVE WORKER, verified email, complete minimum profile, required skill levels, unrelated ownership and available published capacity. No lifetime reapply. Offer creation requires verified ACTIVE Employer and current personal/Company management authority. PAUSED retains existing hiring actions; CLOSED permits only existing pending acceptance, no new Offer. Offers capture Job terms and owner display, optionally a separate VND range and expiry. Revoke/decline/expiry returns the pipeline to SHORTLISTED; changing terms requires a new revision.

Acceptance locks actor→owner→Job→Application→Offer and atomically creates one Engagement. ACCEPTED/IN_PROGRESS/COMPLETED occupy slots; CANCELLED frees one. Employer starts; Worker requests completion; Employer confirms. Either party may explicitly cancel active work with bounded category/reason. Suspended parties retain only these existing active work actions; banned work exceptions remain deferred and fail closed. Job cancellation/explicit completion cleans pending recruitment transactionally and preserves history.

Private API actions: POST `/api/marketplace/jobs/:id/apply`; GET `/worker-applications` and `/(worker|employer)-applications/:id`, GET `/employer-jobs/:id/applications`; POST `/worker-applications/:id/withdraw`, `/employer-applications/:id/view|shortlist|reject|offers`, `/offers/:id/accept|decline|revoke`, `/(worker|employer)-engagements/:id/start|request-completion|confirm-completion|cancel` (side-specific authorization). Offer history is bounded GET `/(worker|employer)-applications/:id/offers`. Unknown fields/actions, identity injection and cross-origin writes fail safely. There is no public applicant API, automatic contact release or deployment. Phase 7 adds contextual messaging below.

## Search and matching (Phase 6)

PostgreSQL 18 UTF8 is required for the reviewed built-in Unicode collation. `/jobs?q=đối+chiếu` uses generated title/description FTS with a partial GIN index; skill names remain relational filters. `simple` tokenization is accent-sensitive and has no Vietnamese stemming. Compensation range overlap requires an explicit matching pay unit; no hourly/monthly conversion. Ranking is quantized text relevance, newest publication, then stable ID, independently of personalized matching.

Workers use `/worker/jobs/recommended`; current Employers use `/employer/jobs/[jobId]/candidates` for PUBLISHED/PAUSED Jobs. APIs are GET `/api/marketplace/worker-recommendations` and `/api/marketplace/employer-jobs/:id/candidates`. Current roles, ACTIVE status, profile, Company membership and Worker opt-in are enforced server-side. No arbitrary Worker-ID scoring endpoint exists. Worker recommendations exclude own/current-company and previously applied Jobs. Eligibility does not guarantee capacity or later verified-email apply/accept checks.

Each request scores at most the first 200 eligible-prefiltered IDs and pages up to 30 within that pool; this is not a global best-match search. Profile/Job changes can reorder subsequent requests. “Mức độ phù hợp” shows numeric score, coverage and all seven components. Skills/availability/location are measurable; Phase 8 additionally measures rating/reliability when real facts exist. Compensation/experience remain uncovered. Covered weights are normalized, so 100/100 at 50% coverage is possible and is not a Relevant Applicant (which also requires coverage ≥60%). New Applications store immutable minimal match-at-apply metadata; legacy rows remain null. See PHASE_6 for historical formulas and PHASE_8 for deterministic-v2 reputation/coverage.

## Messaging and notifications (Phase 7)

Open **Mở tin nhắn** from an authorized Application detail; retries open the same Worker×Job conversation. `/worker/messages` and `/employer/messages` show current-scope inbox/unread totals; `/<side>/messages/[conversationId]` shows context, plain text, send, older history, read state and author-specific block/unblock. `/notifications` lists own durable NEW_MESSAGE notifications with safe internal links/read controls. No arbitrary message button exists on discovery/matching. Invitation acceptance is deferred D6; no pending-invite entitlement or outreach/DM API.

Current personal owner/current Company OWNER/MANAGER is the employer side; historical recruiter membership is not retained. Actual author display/side is shown without identity/contact IDs. Application opt-out from discovery does not remove its chat. Active ACCEPTED/IN_PROGRESS work preserves scoped chat across block/CLOSED/suspension. Pre-work block disables both directions and terminal Application/Engagement leaves history read-only. BANNED/removed roles fail closed. Company blocks consider current managers as one employer context, avoiding recruiter-switch bypass; each user's read marker remains independent.

Text1–4000 characters, escaped/no HTML execution/Markdown/embeds/uploads. Visible-page polling every8s, cursor pages default30/max50, max200 recent messages locally; older-page browsing pauses polling. Resume through “Về tin mới”. Mark read advances using a server Message position, never browser time. Sends require a stable UUID creationKey; changed-body replay conflicts, authorized same-body replay is free. PostgreSQL fixed-window budgets:30/user/conversation/minute and60/user/minute. Repeated identical bodies under new keys consume budget.

API prefix `/api/marketplace`: POST `/(worker|employer)-applications/:id/conversation` with `{}`; GET `/(worker|employer)-conversations` (limit/cursor), GET `/:id`, GET `/:id/messages` (limit/before OR after); POST `/:id/messages` with body/creationKey, POST `/:id/read` with messageId, POST `/:id/block` with opposite-side messageId/blocked. Notifications GET `/notifications` (limit/cursor), POST `/notifications/:id/read` with messageId. All writes require real session/exact origin/strict bounded JSON and fresh scope; server derives author/role/owner.

One unread Notification per conversation/direct recipient coalesces until covered by a read marker. Employer messages notify Worker; Worker messages notify a personal Employer. Company managers use independent inbox unread state, with no N-member durable fan-out. No message body/JSON payload/contact is duplicated. In-app records commit with Message, so no asynchronous outbox/daemon/cron is needed. Hiring-event notifications, email/preferences and accepted invitations remain deferred rather than claimed implemented.

CI chain now adds `pnpm test:messaging` after matching and before HTTP; all seven integration commands require the documented explicit disposable flags/migrations. `pnpm test:http` retains Phase2–6 and adds real Phase7 routes/pages, XSS/origin/bounds/IDOR, read/block/notifications/current membership and suspended active work. See [PHASE_7](PHASE_7.md) for executed results and publication evidence. Production remains managed Node/Next + env + PostgreSQL18 UTF8, independent of a developer PC; no deployment is performed.

## Reviews and reputation (Phase 8)

Completed Application/Engagement detail shows a one-time 1–5 star review with optional plain text (max2000). Worker reviews the stable Company/personal EmployerProfile; current personal owner or Company OWNER/MANAGER reviews Worker. First authorized Company actor consumes the single Company-side slot. Submitted reviews cannot be edited/deleted; blocked participants may review completed work without reopening chat. SUSPENDED/BANNED deny submission; there is no ADMIN bypass or review notification/reply.

Public Job detail shows owner rating/count and completed hires. Full owner text is `/worker/jobs/[jobId]/reviews` for ACTIVE WORKER. Opted-in Worker reviews are `/employer/workers/[workerId]/reviews` for ACTIVE EMPLOYER/profile; managed Application detail retains safe context when discovery is off. Worker authors remain generic verified-work identities; Company authors show historical Company display. Lists20/max30 use target-bound recent cursors. Hidden records are excluded; no hide API. No anonymous Worker directory.

API: GET/POST `/api/marketplace/(worker|employer)-engagements/:id/reviews`, GET `/jobs/:id/reviews` and `/workers/:id/reviews` (authenticated). POST accepts only integer rating, nullable optional comment and UUID creationKey. Public GET Job detail includes owner reputation aggregate only. Matching now keeps weightsVersion=v1, algorithmVersion=deterministic-v2. Exact rating `(sum-count)/(4count)`, Worker reliability `completed/(completed+Worker-caused cancellation)`; no sample gives uncovered. At most80% coverage; pay/experience remain unknown. Old v1/null Application snapshots stay frozen. Reputation is batched in one SQL statement for up to200 workers; no Redis/counters/PC worker. Employer completion-rate attribution and review notifications/moderation remain deferred. [PHASE_8](PHASE_8.md) records actual checks.

## Dependencies and boundaries

Next/React render the app; TypeScript/ESLint check it (@next/eslint-plugin-next and typescript-eslint directly); Tailwind/PostCSS and minimal shadcn config/classes establish styles. Prisma/client/adapter-pg/pg connect PostgreSQL; server-only protects imports; Zod validates explicit boundaries; Vitest runs safety tests; tsx runs DB/auth probes; @next/env shares env precedence. Better Auth 1.7.7 and @better-auth/prisma-adapter 1.7.7 add auth only. Resend adapter uses native fetch without another SDK dependency. No social login, business provider or marketplace domain dependency is installed.

## Phase 10 verification

On an explicitly isolated PostgreSQL with all committed migrations, run pnpm test:hardening in addition to the Phase 2–9 and HTTP suites. All test commands require TEST_DATABASE_URL, AUTH_TEST_DATABASE=disposable and a database name containing a separate test/disposable segment; the parent must not run in production mode. There is no DATABASE_URL fallback. After pnpm build, pnpm test:production runs actual next start without fake-mail preload, checks secure production cookies/session/logout, headers/public/private responses and missing-email failure, then stops its child and cleans owned fixtures. CI runs both new commands.

Security headers are built from next.config.ts. Optional ENABLE_HSTS=1 applies only to an explicitly HTTPS production build after TLS/domain review; default is off. Production auth rejects loopback origins. See SECURITY for the account-status matrix, rate budgets, pragmatic inline-bootstrap CSP limitation and current dependency audit. This phase performs no website deployment; production provider/load/backup/retention/proxy work remains deferred.

## Phase 12 production readiness

[Phase 12 evidence](PHASE_12.md) · [Production runbook](PRODUCTION_RUNBOOK.md). Public release is BLOCKED pending the correct user-owned Vercel account, managed PostgreSQL18, verified real email and operations/privacy signoff. No production URL is claimed. vercel.json disables automatic Git deployments; controlled deployment follows green exact-SHA CI, backup verification and a separate direct-connection migration step. Node24/pnpm11.25 are pinned; build never migrates. pnpm db:release-check verifies committed SQL checksums and required database catalog objects read-only; CI runs it on its disposable PostgreSQL. Private/auth/API responses carry noindex/nofollow and robots disallows private paths, alongside existing server authorization. Optional monitoring/analytics remain Noop. See SECURITY for the narrow mysql2 patch and two remaining high advisories.
