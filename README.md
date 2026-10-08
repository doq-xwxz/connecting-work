# Connecting Work

Tìm đúng việc. Gặp đúng người.

Phase 6 adds PostgreSQL Job search and deterministic, explained Worker/Job matching to the transactional marketplace. Personal/Company Jobs, quota, verified dual roles, immutable Offers and atomic Engagement capacity remain in place. [PRODUCT.md](PRODUCT.md) remains source of truth; [PHASE_0.md](PHASE_0.md) records approved architecture/deferred decisions. Phases 0–5 are approved; stop for Phase 6 review. No Phase 7 or deployment.

## Documentation

[AGENTS](AGENTS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [ROADMAP](ROADMAP.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [Phase 1 historical report](PHASE_1.md) · [Phase 2 evidence](PHASE_2.md) · [Phase 3 historical review](PHASE_3.md) · [Phase 4 historical review](PHASE_4.md) · [Phase 5 historical review](PHASE_5.md) · [Phase 6 review](PHASE_6.md)

## Local setup

Use Node 24 (tested version in `.node-version`) and pnpm 11.25.0 (`packageManager`). Install pnpm through your approved runtime/package-manager setup if missing; no second lockfile/package manager.

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Open http://127.0.0.1:3000. Landing/auth pages and build need no runtime credentials; real Job data needs migrated PostgreSQL. For working auth, configure ignored .env.local or hosting env: DATABASE_URL, APP_URL, BETTER_AUTH_SECRET, EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM. BETTER_AUTH_URL is optional and must match APP_URL if supplied; DIRECT_DATABASE_URL optionally selects an unpooled migration endpoint. Apply committed migrations before using auth. No real secrets are supplied. Missing auth/provider config fails safely when used. No SQLite or infrastructure provisioning. See [DATABASE](DATABASE.md) and [SECURITY](SECURITY.md).

Routes: /sign-up, /sign-in, /verify-email, /forgot-password, /reset-password and protected /account. Verify email before sign-in; choose one/both normal roles on account after login. ADMIN is trusted operational provisioning only, never a form option. Verification/reset mail links use fragments and POST confirmation; do not copy tokens into logs/issues. For manual local tests, use a sender and recipient controlled by the operator. Automated tests use a fake email provider, never real email.

Staging/production: set an explicit HTTPS APP_URL, a random secret of at least 32 characters, managed PostgreSQL with verified TLS/provider pooling, and configured email sender. Preview branches need their own explicit origin, isolated database and secrets; no automatic trust of arbitrary Vercel hosts. Managed hosts inject env. pnpm start respects managed PORT/binding defaults; only pnpm dev intentionally binds loopback. No identity/session data lives on the operator's filesystem or in process memory. On Vercel use the Node runtime, align DB region and verify trusted proxy IP/rate-limit behavior. Email work uses Next after, which the managed Next host must support. No deployment occurs here.

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

CI runs frozen install, schema validation, lint, typecheck, unit tests and build, plus a fresh PostgreSQL 18 service for committed migrations, DB smoke, `pnpm test:integration`, `pnpm test:profiles`, `pnpm test:jobs`, `pnpm test:hiring`, `pnpm test:matching`, and `pnpm test:http` (actual Next Phase 2–6 routes/pages). All six integration commands require explicit TEST_DATABASE_URL, AUTH_TEST_DATABASE=disposable and applied migrations on that dedicated PostgreSQL DB. Scope DATABASE_URL/DIRECT_DATABASE_URL to the same disposable endpoint for migration/smoke commands; never use production. Tests clean only their own fixtures. The HTTP child starts/stops automatically and intercepts only email transport. No browser E2E dependency, deployment or production/provider secret was added. See PHASE_6 for current evidence; earlier reports remain historical.

## Jobs (Phase 4)

Anonymous `/jobs` and `/jobs/[jobId]` show PUBLISHED ads only. Current Employers use `/employer/jobs`, `/new`, `/[jobId]`, `/[jobId]/edit`; an EmployerProfile is required. Choose personal ownership or a company you currently manage. Save DRAFT first, then publish after validation and verified email. Each personal profile/company has three PUBLISHED+PAUSED slots; pausing does not free a slot. CLOSED never reopens: duplicate to a fresh DRAFT. Phase 5 adds Apply and an explicit CLOSED→COMPLETED action after work obligations finish.

Public APIs are GET `/api/marketplace/jobs` and `/jobs/:id`; private Job APIs use `/api/marketplace/employer-jobs`, PUT `/:id`, and POST `/:id/publish|pause|resume|close|cancel|complete|duplicate`. Client forms send explicit structured fields and optimistic expectedVersion. Public filters include q/city/employmentType/workMode/category/skillId and compensation unit/range, with a bounded filter-bound cursor/default 12/max 30. Unknown/duplicate filters fail safely. Compensation is an exact whole-VND string range; schedule uses recurring local whole hours; dates are date-only. No exact workplace address is stored.

Run `pnpm test:jobs` then `pnpm test:hiring` before `test:http` on the documented disposable PostgreSQL. Jobs/hiring need migrated runtime PostgreSQL; production build and landing remain credential-free. No operator-PC process is needed in production. The first Application now activates material edit restrictions from real rows; description wording remains editable. See PHASE_5 for evidence.

## Hiring (Phase 5)

Workers use `/worker/applications` and `/worker/applications/[applicationId]`; Employers use `/employer/jobs/[jobId]/applications` and `/employer/applications/[applicationId]`. Apply requires ACTIVE WORKER, verified email, complete minimum profile, required skill levels, unrelated ownership and available published capacity. No lifetime reapply. Offer creation requires verified ACTIVE Employer and current personal/Company management authority. PAUSED retains existing hiring actions; CLOSED permits only existing pending acceptance, no new Offer. Offers capture Job terms and owner display, optionally a separate VND range and expiry. Revoke/decline/expiry returns the pipeline to SHORTLISTED; changing terms requires a new revision.

Acceptance locks actor→owner→Job→Application→Offer and atomically creates one Engagement. ACCEPTED/IN_PROGRESS/COMPLETED occupy slots; CANCELLED frees one. Employer starts; Worker requests completion; Employer confirms. Either party may explicitly cancel active work with bounded category/reason. Suspended parties retain only these existing active work actions; banned work exceptions remain deferred and fail closed. Job cancellation/explicit completion cleans pending recruitment transactionally and preserves history.

Private API actions: POST `/api/marketplace/jobs/:id/apply`; GET `/worker-applications` and `/(worker|employer)-applications/:id`, GET `/employer-jobs/:id/applications`; POST `/worker-applications/:id/withdraw`, `/employer-applications/:id/view|shortlist|reject|offers`, `/offers/:id/accept|decline|revoke`, `/(worker|employer)-engagements/:id/start|request-completion|confirm-completion|cancel` (side-specific authorization). Offer history is bounded GET `/(worker|employer)-applications/:id/offers`. Unknown fields/actions, identity injection and cross-origin writes fail safely. There is no public applicant API, contact release, messaging or deployment.

## Search and matching (Phase 6)

PostgreSQL 18 UTF8 is required for the reviewed built-in Unicode collation. `/jobs?q=đối+chiếu` uses generated title/description FTS with a partial GIN index; skill names remain relational filters. `simple` tokenization is accent-sensitive and has no Vietnamese stemming. Compensation range overlap requires an explicit matching pay unit; no hourly/monthly conversion. Ranking is quantized text relevance, newest publication, then stable ID, independently of personalized matching.

Workers use `/worker/jobs/recommended`; current Employers use `/employer/jobs/[jobId]/candidates` for PUBLISHED/PAUSED Jobs. APIs are GET `/api/marketplace/worker-recommendations` and `/api/marketplace/employer-jobs/:id/candidates`. Current roles, ACTIVE status, profile, Company membership and Worker opt-in are enforced server-side. No arbitrary Worker-ID scoring endpoint exists. Worker recommendations exclude own/current-company and previously applied Jobs. Eligibility does not guarantee capacity or later verified-email apply/accept checks.

Each request scores at most the first 200 eligible-prefiltered IDs and pages up to 30 within that pool; this is not a global best-match search. Profile/Job changes can reorder subsequent requests. “Mức độ phù hợp” shows numeric score, coverage and all seven components. Skills/availability/location are measurable; compensation/experience/rating/reliability remain uncovered. Covered weights are normalized, so 100/100 at 50% coverage is possible and is not a Relevant Applicant (which also requires coverage ≥60%). New Applications store immutable minimal match-at-apply metadata; legacy rows remain null. See PHASE_6 for exact formulas and verification.

## Dependencies and boundaries

Next/React render the app; TypeScript/ESLint check it (@next/eslint-plugin-next and typescript-eslint directly); Tailwind/PostCSS and minimal shadcn config/classes establish styles. Prisma/client/adapter-pg/pg connect PostgreSQL; server-only protects imports; Zod validates explicit boundaries; Vitest runs safety tests; tsx runs DB/auth probes; @next/env shares env precedence. Better Auth 1.7.7 and @better-auth/prisma-adapter 1.7.7 add auth only. Resend adapter uses native fetch without another SDK dependency. No social login, business provider or marketplace domain dependency is installed.
