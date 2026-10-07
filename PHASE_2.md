# 1. Phase 2 Summary

Implemented locally on 2026-10-07: Better Auth email/password, verification/reset, database sessions, dual normal roles, account status, server authorization primitives and minimal account UI. Stop for Phase 2 review; Phase 3, marketplace schemas, deployment and automatic push are not performed. PRODUCT.md remains source of truth and has no changes.

Publication follow-up (2026-10-07): after the local handoff, the user explicitly authorized committing and pushing Phase 2 to GitHub. The checks and Git status below describe the implementation handoff before publication. Consult GitHub Actions for checks on the published revision. Database integration remains blocked until a dedicated PostgreSQL test database is configured.

Initial inspection: clean main at f3ae681 (`chore: add Connecting Work foundation`), tracking origin/main on https://github.com/doq-xwxz/connecting-work.git. Existing Prisma 7/PostgreSQL/server-only boundaries and CI preserved. PHASE_1 is a historical report; its earlier untracked/no-commit/no-remote-run state was subsequently superseded by the user's GitHub synchronization. No approved product contradiction was found. Prior AGENTS Phase 1 restriction was superseded by explicit Phase 2 authorization and updated accordingly.

Implemented is distinct from verified: offline/local checks pass, but live PostgreSQL/auth flows remain BLOCKED. No auth success on a real database is claimed.

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
| DB migration deploy/status | BLOCKED | No DATABASE_URL or disposable PostgreSQL endpoint; no live application claimed |
| DB smoke | BLOCKED | db:smoke reports missing DATABASE_URL, exit 2 |
| DB integration | BLOCKED | test:integration reports TEST_DATABASE_URL + AUTH_TEST_DATABASE=disposable missing, exit 2 |
| Auth E2E (signup→verify→login→account→logout) | BLOCKED | No database/provider runtime config; no fake success or SQLite |
| Browser UI/failure-path check | PASS | Signup layout visually inspected; forgot-password POST 503 produced safe UI message; token-fragment confirmation page displayed and removed fragment from address |
| Production HTTP/headers | PASS | All five public auth pages HTTP 200; verification/reset no-referrer + no-store; missing-config auth POST 503 with constant safe message |
| Remote GitHub Actions, existing Foundation commit | PASS | Run 37587454640, f3ae681, completed/success; every install/schema/lint/types/unit/build step success; workflow active |
| Remote GitHub Actions, current Phase 2 diff | BLOCKED | Changes not pushed; no Phase 2 remote run exists yet |

Unit checks cover dual roles/ADMIN rejection/mass assignment, verified state/status guard, exact origins, unsafe redirects, strict signup and token input, body limits, safe HTTP payloads including session projection, provider-error non-disclosure and existing error/logger safety tests. They do not prove real session/logout/token consumption behavior.

`scripts/auth-integration.ts` authors real PostgreSQL + Better Auth checks: signup/duplicate signup, verification/expired signature, login/fixation/cookie attributes, session persistence across auth objects, concurrent duplicate role activation, ADMIN rejection, stale-principal suspension guard, logout reuse, reset expiry/reuse/session revocation and generic unknown-account response. Credentials are randomly generated in test memory and not printed. Fixture cleanup/disconnect errors are safely suppressed and marked failure. This suite has not run against a DB and is not reported PASS.

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

Runtime auth needs DATABASE_URL, APP_URL, BETTER_AUTH_SECRET and configured email delivery (EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM); all absent here. DIRECT_DATABASE_URL optional. Tests additionally require TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable with the committed migrations applied to that dedicated DB. Do not supply production DB for testing. Full session/token/DB behaviors and real mail delivery are unverified, and current Phase 2 remote CI awaits explicit publication. These are reported, not bypassed.

Deferred: Phase 3 profiles/company and every marketplace feature; resource ownership/membership/state and active-Engagement policy; full BANNED semantics D5; durable notifications/outbox; admin moderation/dashboard/business audit; social providers; deployment. No auto-continuation.

# 14. Git diff summary

47 changed paths: 16 tracked modifications and 31 new files, no deletions. Initial tracked base is f3ae681 on main, origin unchanged. PRODUCT.md, PHASE_0.md and PHASE_1.md have no diff. Reviewed auth/schema/config/UI/test/docs changes, dependency scope, additive migration SQL and ignored credentials/artifacts. Tracked and new-file whitespace checks pass after line-ending normalization. No secrets or generated/build outputs are staged. No commit, push, history rewrite or deployment in this phase. Stop here for review.
