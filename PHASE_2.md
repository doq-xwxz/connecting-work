# 1. Phase 2 Summary

Implemented locally on 2026-10-07: Better Auth email/password, verification/reset, database sessions, dual normal roles, account status, server authorization primitives and minimal account UI. Stop for Phase 2 review; Phase 3, marketplace schemas, deployment and automatic push are not performed. PRODUCT.md remains source of truth and has no changes.

Publication follow-up (2026-10-07): after the local handoff, the user explicitly authorized committing and pushing Phase 2 to GitHub. The checks and Git status below describe the implementation handoff before publication. Consult GitHub Actions for checks on the published revision. Database integration remains blocked until a dedicated PostgreSQL test database is configured.

Initial inspection: clean main at f3ae681 (`chore: add Connecting Work foundation`), tracking origin/main on https://github.com/doq-xwxz/connecting-work.git. Existing Prisma 7/PostgreSQL/server-only boundaries and CI preserved. PHASE_1 is a historical report; its earlier untracked/no-commit/no-remote-run state was subsequently superseded by the user's GitHub synchronization. No approved product contradiction was found. Prior AGENTS Phase 1 restriction was superseded by explicit Phase 2 authorization and updated accordingly.

At the initial implementation handoff, live PostgreSQL/auth flows were BLOCKED. The subsequent closure verification below supersedes those blockers with real disposable PostgreSQL and Next HTTP evidence; earlier inspection and delivery facts remain historical.

# 2. Versions / dependencies added or changed

Added exact stable `better-auth@1.7.7` and `@better-auth/prisma-adapter@1.7.7` (20 transitive packages added). Registry peer constraints support existing Next 16, React 19 and Prisma 7. Frozen install and peer check pass. No auth admin/social plugin or Resend SDK is installed; the small Resend adapter uses native fetch and a provider-independent auth-mail contract.

Unchanged core: Node 24.20.0, pnpm 11.25.0, Next/@next/env 16.4.0, React 19.3.0, Prisma 7.10.0, pg 8.23.1, TypeScript 6.0.3, Tailwind 4.3.3, ESLint 10.12.0, Zod 4.6.5 and Vitest 5.0.3. pnpm is the sole package manager. Production start changed from a hardcoded loopback bind to `next start`; dev retains an intentional loopback bind.

Official integration/API references verified before installing: [Next App Router](https://better-auth.com/docs/integrations/next), [Prisma/PostgreSQL](https://better-auth.com/docs/adapters/prisma), [email/password](https://better-auth.com/docs/authentication/email-password), [email delivery](https://better-auth.com/docs/concepts/email), [sessions](https://better-auth.com/docs/concepts/session-management), [options](https://better-auth.com/docs/reference/options), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [Resend send API](https://resend.com/docs/api-reference/emails/send-email). Installed version source/types were also inspected for actual verification HTTP method, reset expiry/session revocation and rate-limit schema behavior.

# 3. Database changes

New migration: `prisma/migrations/20261007010000_auth/migration.sql`, generated offline from HEAD's Phase 1 schema to current schema. Regenerated SQL matches exactly after line-ending normalization. It is additive: six tables and two enums, unique constraints/indexes/FKs; no reset, destructive SQL or migration application occurred.

Models: User (email/name/emailVerified/server-owned status), Session (expiry/token/user relation), Account (Better Auth credentials contract), Verification (reset identifiers/value/expiry), UserRole (compound PK userId+role, grantedAt/grantedBy), RateLimit (cross-instance counters). Enums: Role WORKER/EMPLOYER/ADMIN and AccountStatus ACTIVE/SUSPENDED/BANNED. User.status is non-input/non-returned in Better Auth. UserRole is application-owned, absent from signup/update input. No marketplace models exist. Auth-only Session/Account FKs cascade; role provenance restricts User deletion. No public delete-user endpoint is exposed.

FoundationCheck remains temporarily: live Foundation smoke has never passed and its rollback probe still provides a minimal independent DB check. Remove through a separate reviewed migration after actual auth integration coverage passes. It is not an unexplained permanent domain table. Migration commands, cloud pooling/TLS and test isolation are in DATABASE.md.

Attempting a diff from a migrations directory required a configured shadow DB; no shadow endpoint exists. Used committed-schema-to-schema offline diff instead. This proves reproducible SQL, not live deploy/status correctness. Live migration deploy/status remains BLOCKED.

# 4. Authentication flows implemented

- Signup: strict bounded name/email/password input, no roles/status/emailVerified/extra fields; password 12–128 characters; no automatic session or role grant; verification delivery initiated. Generic duplicate responses are supplied by Better Auth and mutation output is reduced to `{ok:true}`.
- Verification: one-hour Better Auth token; email URL fragment opens a confirmation page; user POST confirms. Internal library GET verifier is not publicly exposed. No automatic sign-in. Fragment is cleared from history once captured; React Strict Mode replays cannot discard it.
- Sign-in: email/password only, verified email required; new Better Auth session/cookie. Generic user-facing failure message, no raw library response token or error.
- Sign-out: POST invalidates the database session and forwards cookie clearing. No token storage in localStorage.
- Reset: generic request response, 30-minute reset token, POST password update; Better Auth consumes token and revokes sessions. Tokens travel in email fragments and bounded POST body, never app logs/public page query URLs.

Provider interface covers auth mail only. Resend native-fetch adapter resolves credentials at actual send time. Missing configured email provider returns 503 before signup/request/resend proceeds. Next after retains asynchronous delivery on the managed runtime; immediately attached failure handling logs only a static event, no recipient/token/provider error. Tests inject fake delivery; no real test email was sent. Future durable notification/outbox is deferred.

# 5. Role / account-status model

Normal self-activation accepts exactly one WORKER or EMPLOYER role, additive/idempotent; both may coexist. Actor/user ID comes from the validated session. ADMIN strings, arrays, alternate fields and mass-assignment input fail. Database uniqueness plus row-locked upsert prevents duplicate grants. No public admin registration/grant or Better Auth admin plugin.

Trusted ADMIN provisioning is documented in SECURITY.md: reviewed verified ACTIVE identity, exact user ID, least-privileged direct DB operator, user-row lock, bound/idempotent grant and operator/change reference in grantedBy, approval retained in the operator audit system. No actual ADMIN was provisioned and no moderation/audit dashboard was built.

General authentication retains account access for SUSPENDED; new activity/role activation requires ACTIVE, even for ADMIN. Current status is re-read inside the grant transaction. BANNED is represented and denied for this scoped new-activity action; full ban/obligation exceptions remain D5. No Engagement-specific logic exists.

# 6. Authorization primitives

`requireAuthenticatedUser(headers)` validates Better Auth session and reads current User/UserRole projection. `hasRole` / `requireRole` check explicit any-of roles without ADMIN bypass. `requireVerifiedEmail` checks current verification state. `requireCanCreateActivity` guards ACTIVE eligibility independently of authentication. These do not grant future ownership/company/state access.

Server-only principal/role service wrappers expose authorized operations to pages/handlers. Role mutation derives its principal server-side, locks User and rechecks status before upsert. Future moderation must serialize on the same row. Pure policy helpers remain testable without mocking database/session security. Hidden controls and route redirects provide no authorization guarantee; direct API invocation uses the same guards.

# 7. Routes / UI added

Auth route group: /sign-up, /sign-in, /verify-email, /forgot-password, /reset-password. Account route group: dynamic /account showing only own name/email, verification, roles/status and controlled normal-role buttons/sign-out. No business dashboard or profile fields. Labels, password autocomplete, keyboard focus, busy/disabled states and accessible status/error messages are present.

API: /api/auth/[...all] with explicit read/mutation allowlist; /api/account/roles POST. Allowed public GET auth reads: ok/get-session (safe projection without session token). Verification GET, update/delete/link/social/admin endpoints are denied. Landing links to auth and still states marketplace functions are unavailable.

# 8. Security controls

Exact configured Origin required for POST, missing/null rejected, cross-site Fetch Metadata rejected; Better Auth CSRF/origin/redirect checks stay enabled. No wildcard CORS. Fixed local callbacks, strict Zod object fields, 16 KiB streamed JSON limit. No public identity mutation GET. Safe error DTOs/status with generated correlation IDs, no SQL/stack/password/token/cause. Session cookie forwarding/clearing preserved, raw mutation DTOs and session tokens removed from browser JSON.

HttpOnly/SameSite=Lax cookies, Secure in production; cookie cache disabled; DB sessions/current-role/status checks; no custom password hashing/crypto. Verification/reset expiry and reset revocation configured in the provider. Sensitive pages no-referrer/no-store; token fragments stay out of server URL logs and are cleared. Auth library logging disabled; email background failures have fixed allowlisted events. No sensitive request payload/body logging added. Production host/proxy must also avoid body logging.

Rate limiting explicitly uses PostgreSQL with per-endpoint windows, not process memory. Before public release, confirm managed host trusted proxy/IP forwarding; no trusted IP means a shared fallback bucket. Secret env is server-only and validated lazily, with explicit HTTPS production origin and no localhost fallback. Actual env/generated/build/temp files remain ignored; .env.example remains eligible for Git. Token/private-key pattern scan found no matches; built static JS scan found no DATABASE_URL/BETTER_AUTH_SECRET/RESEND_API_KEY/PrismaClient references. Synthetic unit-test literals are not real credentials.

# 9. Tests

| Check | Status | Evidence / limitation |
|---|---|---|
| Frozen install | PASS | pnpm install --frozen-lockfile --fetch-timeout=600000; already up to date |
| Peer dependencies | PASS | pnpm peers check: no issues |
| Lint | PASS | pnpm lint, zero warnings |
| Typecheck | PASS | Prisma generate + Next typegen + strict tsc |
| Unit | PASS | 8 files / 68 tests, including 17 preserved Foundation tests |
| Build | PASS | Production compiled/types/prerender; public auth pages static, account/API dynamic; no runtime credentials needed |
| Prisma validation | PASS | Schema valid, generated client succeeds |
| Migration offline verification | PASS | Regenerated auth SQL equals reviewed migration; additive-only source review |
| DB migration deploy/status | PASS | Closure: Foundation/Auth applied to fresh PostgreSQL 18.6, cleanup applied afterward, status up to date; previously BLOCKED at handoff |
| DB smoke | PASS | Real migration-backed CRUD/rollback passed before and after FoundationCheck removal; previously BLOCKED |
| DB integration | PASS | Real PostgreSQL suite passed before/after cleanup; expiry/replay/revocation/roles/limits checked; previously BLOCKED |
| Auth E2E (signup→verify→login→account→logout/reset) | PASS | Actual Next HTTP routes/pages + real DB, test-only mail transport; previously BLOCKED; not a full browser automation claim |
| Browser UI/failure-path check | PASS | Signup layout visually inspected; forgot-password POST 503 produced safe UI message; token-fragment confirmation page displayed and removed fragment from address |
| Production HTTP/headers | PASS | All five public auth pages HTTP 200; verification/reset no-referrer + no-store; missing-config auth POST 503 with constant safe message |
| Remote GitHub Actions, existing Foundation commit | PASS | Run 37587454640, f3ae681, completed/success; every install/schema/lint/types/unit/build step success; workflow active |
| Remote GitHub Actions, Phase 2 implementation | PASS | a22f968, run 37591825052 completed/success after publication; closure revision checked separately after push |

Unit checks cover dual roles/ADMIN rejection/mass assignment, verified state/status guard, exact origins, unsafe redirects, strict signup and token input, body limits, safe HTTP payloads including session projection, provider-error non-disclosure and existing error/logger safety tests. They do not prove real session/logout/token consumption behavior.

`scripts/auth-integration.ts` verifies real PostgreSQL + Better Auth checks: signup/duplicate signup, verification/expired signature, login/fixation/cookie attributes, session persistence across auth objects, concurrent duplicate role activation, ADMIN rejection, stale-principal suspension guard, logout reuse, reset expiry/reuse/session revocation and generic unknown-account response. Credentials are randomly generated in test memory and not printed. Fixture cleanup/disconnect errors are safely suppressed and marked failure. The suite subsequently passed on real PostgreSQL during closure, including persisted rate-limit enforcement and hashed reset identifier/consumption assertions.

No large browser E2E framework added while live auth is blocked. CI retains meaningful offline checks, no deploy/production secrets. PostgreSQL suite remains separate pending its first real isolated run; DATABASE documents how to enable it. GitHub Actions investigation used public read-only API for workflows/run/jobs; events push/pull_request are valid and workflow active. No unrelated repo settings changed. [Verified Foundation run](https://github.com/doq-xwxz/connecting-work/actions/runs/37587454640).

# 10. Deployment compatibility

Code remains suitable for public Internet deployment independent of the developer PC: managed Next.js Node runtime, cloud PostgreSQL identity/session/rate data, environment-injected origin/secrets/provider config, Next after for mail lifecycle. No production loopback-only logic, filesystem inbox, local persistence, operator daemon or in-memory auth state. Only intentional local dev/test URLs use localhost. `next start` respects hosting port/binding defaults.

This is compatibility, not a deployed or fully exercised production auth system. Operator must configure isolated cloud DB/TLS/pool capacity, explicit staging/production HTTPS APP_URL, random BETTER_AUTH_SECRET, sender/provider and trusted proxy forwarding, apply migrations and pass real DB/E2E tests. Vercel/equivalent host must support Node/Next after. No deploy occurred.

# 11. Files modified

16 existing files modified: .env.example, .github/workflows/ci.yml (name only), AGENTS.md, ARCHITECTURE.md, DATABASE.md, README.md, ROADMAP.md, SECURITY.md, next.config.ts, package.json, pnpm-lock.yaml, prisma/schema.prisma, scripts/db-smoke.ts (safe disconnect failure), src/app/layout.tsx, src/app/page.tsx, src/modules/README.md.

31 new files including this report: auth migration; scripts/auth-integration.ts; account page; auth layout and five pages; two API route files; modules/auth README, components/auth-form.tsx and account-controls.tsx, config.ts/config.test.ts, factory.ts, http.ts/http.test.ts, policy.ts/policy.test.ts, principal.ts, request-policy.ts/request-policy.test.ts, roles.ts, server.ts, service.ts; shared/email contract.ts/contract.test.ts/sender.ts. See git status for exact paths.

# 12. Deviations from PRODUCT / PHASE_0 / PHASE_1

No product requirement or approved architecture decision changed. Verification-before-sign-in, password length 12, one-hour verification/30-minute reset/seven-day sessions and scoped endpoint rate limits are explicit Phase 2 implementation choices, not new marketplace policy. Full D5 ban semantics stay deferred. Existing Phase 1 report is preserved historically, not rewritten to erase previous blockers.

Verification uses a POST confirmation bridge to Better Auth's internal GET handler to satisfy the requested no-public-mutating-GET boundary; email token fragments avoid public token URLs. Direct POST fetches use Better Auth's HTTP handler rather than server auth actions/client session cache, retaining HTTP rate limits and minimizing browser data. No nextCookies plugin is needed because mutations return native handler Set-Cookie through Route Handlers.

FoundationCheck retained with a removal criterion. Real database verification/E2E remains blocked as explicitly allowed. Default CI keeps integration separate until its first isolated DB run. No extra infra/social/provider SDK or speculative permission engine. Resend remains replaceable and business notifications/outbox remain deferred.

# 13. Remaining blockers

At initial handoff all runtime credentials were absent and DB/auth checks were blocked. Closure supplied a dedicated disposable PostgreSQL test environment and synthetic test-only mail configuration; real DB/session/token/HTTP behaviors now passed. Real Resend delivery, a deployed cloud provider's TLS/transaction-pool settings and managed-host proxy/IP forwarding remain deployment-specific checks. No production credentials or deployment were used. See closure evidence below.

Deferred: Phase 3 profiles/company and every marketplace feature; resource ownership/membership/state and active-Engagement policy; full BANNED semantics D5; durable notifications/outbox; admin moderation/dashboard/business audit; social providers; deployment. No auto-continuation.

# 14. Git diff summary

47 changed paths: 16 tracked modifications and 31 new files, no deletions. Initial tracked base is f3ae681 on main, origin unchanged. PRODUCT.md, PHASE_0.md and PHASE_1.md have no diff. Reviewed auth/schema/config/UI/test/docs changes, dependency scope, additive migration SQL and ignored credentials/artifacts. Tracked and new-file whitespace checks pass after line-ending normalization. No secrets or generated/build outputs are staged. No commit, push, history rewrite or deployment in this phase. Stop here for review.

# 15. Real PostgreSQL / auth closure verification — 2026-10-07

## Environment and inspection

Started from clean main at da4cd39a6153369284e7299fc9b3892e3d012340. Read PRODUCT, PHASE_0, architecture, PHASE_1, PHASE_2, AGENTS, DATABASE and SECURITY. PRODUCT/PHASE_0/PHASE_1 remain unchanged. No Phase 3 work or website deployment.

Used a fresh disposable PostgreSQL 18.6 cluster from [EDB's Windows binary archive](https://www.enterprisedb.com/download-postgresql-binaries), stored only in ignored .tmp, loopback-bound and protected by a random password. No installed system service, production data, SQLite or cloud-account provisioning. DATABASE_URL/DIRECT_DATABASE_URL/TEST_DATABASE_URL were scoped to this test database; AUTH_TEST_DATABASE=disposable was explicit. Runtime tests used PrismaPg's bounded connection pool. This verifies real PostgreSQL, not Neon/PgBouncer-specific TLS or transaction pooling. Cloud runtime must use a provider pooled URL, migrations its direct URL, and tests a separate disposable database/branch.

## Migrations, schema and FoundationCheck

PASS: Foundation and Auth migrations applied cleanly to the fresh database, db:status reported up to date, and original FoundationCheck CRUD smoke passed. Auth integration also passed before cleanup. Only then removed the model and applied 20261007020000_remove_foundation_check (DROP TABLE FoundationCheck only). No reset or change to either original migration. Updated db:smoke to roll back transient User CRUD/default checks; reran DB/auth checks successfully. Live Prisma schema diff reported no difference. Resulting public tables: User, Session, Account, Verification, UserRole, RateLimit and _prisma_migrations. Inspected uniqueness/indexes including UserRole compound PK, Session token and User email.

## Auth integration and actual HTTP

PASS: signup, duplicate safety, verification/expired verification rejection, verified login, session fixation resistance, persisted sessions across auth objects, concurrent duplicate role activation, coexistence of WORKER/EMPLOYER, ADMIN self-grant rejection, fresh suspension/new-activity denial, logout invalidation, password reset, expired reset rejection, reset reuse rejection, session revocation and non-enumerating unknown-account response. Also asserted persisted PostgreSQL rate limits across auth instances (429), hashed reset identifier, reset row consumption and no email for unknown accounts.

Initial repeat-run failure exposed shared rate-limit buckets between test runs. Fixed test isolation with a unique documentation-only IPv6 network per run and cleanup of only its keys. Limits remain enabled and unchanged. Added safe static stage names for diagnosis; no assertion payloads, tokens or driver errors printed. This was a test isolation issue; runtime auth logic was not changed.

PASS: pnpm test:http starts the actual Next development server and requests real routes/pages over HTTP. Verified signup → mail-token confirmation POST → login → account page → WORKER → duplicate WORKER → EMPLOYER → both roles on account → logout → old cookie denied → reset → old sessions denied/new password works, plus public ADMIN rejection and suspended mutation denial. The Next child process intercepts only Resend transport with a test-only preload, delivering to an authenticated in-memory loopback inbox; real Next, Better Auth, token handling, database and rate limits remain active. No real mail or provider credential was used. Test server stopped automatically. This is actual HTTP verification, not a claim of newly automated browser clicks; previous browser UI evidence is retained above.

Session/cookie response projection exposes only allowlisted user fields; mutation JSON contains only ok. User.status remained server-owned. Verification email tokens are signed/expiring in Better Auth, not DB rows; reset Verification rows are hashed/expiring/consumed. After tests, inspected counts for User, Session, UserRole and Verification: all zero. Tests remove only their own records and counters.

## Final local validation

| Command | Result |
|---|---|
| pnpm install --frozen-lockfile | PASS |
| pnpm db:validate | PASS |
| pnpm db:deploy | PASS; all three migrations applied, final rerun no pending migrations |
| pnpm db:status | PASS; up to date |
| pnpm db:smoke | PASS; real User CRUD transaction rolled back |
| pnpm lint | PASS; zero warnings |
| pnpm typecheck | PASS |
| pnpm test | PASS; 8 files / 68 tests |
| pnpm test:integration | PASS; real PostgreSQL, unchanged protection limits |
| pnpm test:http | PASS; actual Next routes and protected page flow |
| pnpm build | PASS; public auth pages static, account/API dynamic |
| prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code | PASS; no difference detected |

## CI, security and deployment compatibility

Previous Phase 2 implementation CI [37591825052](https://github.com/doq-xwxz/connecting-work/actions/runs/37591825052) passed for a22f968. Added a separate postgres-auth job with a fresh PostgreSQL 18 service: frozen install/generation/validation/deploy/status/smoke/integration/HTTP. Both push and pull_request remain enabled; permissions stay read-only, no deployment or production/provider secrets. The closure commit's result must be verified after push and reported with its run/commit evidence; this pre-publication report does not invent that result.

PASS: bounded credential/private-key pattern scan, exact disposable credential scan of eligible Git files, and ignored-path review; no matches. Production static JS scan found no DATABASE_URL/BETTER_AUTH_SECRET/RESEND_API_KEY/PrismaClient/test-mail-secret references. Random DB/auth/mail fixture credentials stay in ignored temporary files or child-process memory. The preload is test-only and never imported by app runtime; no new production localhost branch, filesystem inbox, in-memory session store or operator background service. PostgreSQL persists sessions/roles/limits; config still selects runtime DATABASE_URL and direct migration URL. Production continues to require explicit HTTPS origin, injected secrets and a configured real sender. Managed Next/Vercel-equivalent hosting must support Node/Next after. No website deployed.

## Changed files and remaining blockers

Closure changes: prisma/schema.prisma; the FoundationCheck-only cleanup migration; scripts/db-smoke.ts; scripts/auth-integration.ts; new scripts/auth-http.ts and auth-test-mail.mjs; package.json (HTTP test command only); .github/workflows/ci.yml; PHASE_2.md, DATABASE.md, SECURITY.md, README.md and AGENTS.md. No dependency version or lockfile changes.

Local PostgreSQL/auth/HTTP blockers are resolved. Real cloud provider provisioning/TLS/transaction-pool settings, real email deliverability and deployed proxy/IP forwarding are not exercised here and remain release-environment checks. Stop for Phase 2 closure review; no automatic Phase 3 continuation.
