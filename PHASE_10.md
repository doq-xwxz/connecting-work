# Phase 10 — Hardening

Authorized after approval of Phases 0–9. No Phase 11, new product feature or deployment. PRODUCT, historical reports and migrations are preserved.

## Pre-code inventory (2026-10-10)

This checklist was recorded before application changes. Findings are implementation observations, not claims of an exploited vulnerability. Execution evidence will be added after validation.

| Area | Audit observation / planned verification |
|---|---|
| Auth/session | Real DB session/current roles, provider cookie and token controls present. Provider DB limiter uses conditional increments; its expiry pruning deletes ALL RateLimit namespaces, potentially resetting the hour-long report budget after a minute. Replace storage with atomic, namespace-preserving consumption; keep provider rules. |
| Authorization/IDOR | Reviewed marketplace/admin adapters and profile/company/jobs/hiring/matching/chat/review/report/case services. Session actor and relational scopes present; preserve explicit dual roles/current membership. Retain and extend cross-role/foreign-ID regressions. |
| CSRF/origin | Exact configured origin on all writes; GET hiring detail/history currently persists expiry. Make GET project expiry only; actions continue normalizing under locks. Encoded redirect separators need rejection. |
| Validation | Shared streamed 16KiB bound present. Content-Type prefix accepts lookalikes and UTF-8 decode replaces invalid bytes. Profile/job/company/name text lacks consistent well-formed/control checks. Some read/mutation paths ignore query keys. |
| Rate limits | Message/report counters serialize under actor lock, but numbers scattered. Centralize atomic consumption/config; add generous draft creation budget because quota excludes unlimited draft churn. Other apply/review uniqueness and offer state already constrain abuse. |
| XSS/rendering | React escaped text throughout; no application dangerouslySetInnerHTML. Keep plain text, test HTML/event strings and Vietnamese NFC/NFD. No user URL fetch. |
| Headers/cache | nosniff/frame/referrer/private no-store present. Missing CSP/Permissions-Policy/HSTS. Add pragmatic Next-compatible CSP (inline bootstrap explicitly allowed), eval only development; HSTS only explicitly enabled HTTPS production. |
| DB transactions | Database-only effects inside domain transactions; default 5s vs explicit 15s inconsistent. Add whole-transaction bounded retry for recognized 40001/40P01/P2034 only, never email/auth provider transactions. |
| Concurrency/deadlocks | Canonical User→owner→Job→Application→Offer→Engagement→Review/Conversation→Case→Report order present; transaction advisory contact lock present. Verify real transient abort/rollback/retry, case close/action and existing quota/capacity races. |
| Query bounds | Bounded pages/pools and scoped message/review/audit cursors present. Case-report cursor accepts unrelated report IDs; validate within case. Discovery UUID cursors use overly generic base schema; separate member opaque IDs. |
| Performance/N+1 | Matching/reputation batched; messaging inbox batch hydration. Measure 1 vs many inbox/admin pages, synthetic messages and critical EXPLAIN plans, preserve 200/30 caps. |
| Error handling | Seven safe codes present; DB expected conflicts not centrally classified. Add allowlisted Prisma/PG code mapping without message inspection or cause serialization. |
| Logging/privacy | Logger field allowlist and static moderation action logs present. No user content logs; audit remains authoritative. Verify tracked/client artifact secret scans. |
| Admin/moderation | Current ACTIVE ADMIN, bound case and immutable audit/effect guards present. Add cross-case cursor, close/action race and injected rollback tests. |
| Secrets/dependencies | Pinned versions, restricted install scripts, checkout credentials disabled. Initial pnpm audit: 3 high/1 moderate (deepmerge-ts CLI config, unused mysql2 two advisories, dev braces no fix); classify reachability before any upgrade. |
| Production compatibility | Lazy env and managed DB pool present, no local runtime state. Test guard needs shared explicit test-designated DB name in addition to marker; production origin must reject loopback even HTTPS. Verify production next start separately from mail-preloaded dev HTTP. |

## 1. Phase 10 Summary

Hardening of the approved marketplace only. No new lifecycle, role, provider, upload, analytics or deployment. PRODUCT, PHASE_0–9, all ten historical migrations and pnpm-lock.yaml remain unchanged. This is a development hardening review, not production-readiness certification.

## 2. Hardening inventory / findings

**Fixed implementation findings:** Better Auth's global RateLimit expiry pruning could reset unrelated report counters; custom atomic storage now preserves namespaces. Hiring GET detail/history persisted expiry; reads now project overdue state and actions retain locked normalization. JSON MIME prefix matching accepted lookalikes and decoding silently replaced malformed UTF-8; both are strict. Encoded redirect separators, ignored query keys and unscoped case-report cursors are rejected.

**Added hardening:** shared new-ingress text checks, practical security headers, generous draft budget, safe database error classification, bounded confirmed-abort transaction retries/timeouts, stronger test DB guard, PostgreSQL failure/race/performance suite and production next-start smoke.

**Verified existing controls:** real sessions/fresh roles/status, ownership/current membership, scoped dual-role access, block/obligation rules, moderation visibility, immutable work/review/audit history, capacity/quota, parameterized SQL, bounded DTOs, email fragments, provider cookies and private caching. No claim that an implementation finding was exploited.

## 3. Authorization / IDOR

Reviewed adapters and private reads/writes across profiles, Company, Job, Application, Offer, Engagement, Conversation, Message, Review, Report, ModerationCase and AuditEvent. Actor comes from session, not payload; current role/profile/ownership/membership/state/visibility checks remain in owning services. ADMIN does not grant normal marketplace/discovery access. Existing departed-manager and stale-session/admin regressions remain. New real PostgreSQL dual-role tests deny a foreign Worker Application, a Worker's Employer-side Application access and owner self-apply. Case-report cursor and action target identifier are validated before inappropriate deep access. Case inspection remains target-bound and audited.

## 4. Account-status matrix

The authoritative action matrix is in SECURITY.md. ACTIVE still needs relevant scope/state; SUSPENDED denies new recruitment/reviews but retains scoped active-work obligations and exposure reduction; BANNED denies normal marketplace reads/writes and Engagement exceptions, retaining own opt-out and approved scoped Job reduction. Auth/account recovery stays available. Cross-phase tests exercise these decisions without expanding approved exceptions.

## 5. CSRF / Origin / redirect safety

Exact configured Origin on all writes, no permissive CORS/Referer fallback. Real HTTP tests cover absent, foreign, null, differently serialized and correct origins on account/marketplace/admin. Security-sensitive destinations derive from configuration/internal routes, not Host or forwarded-host/proto. Relative redirect tests reject schemes, protocol-relative/encoded/backslash/control variants and malformed escapes. Mail confirmation remains POST with fragment tokens. Marketplace GET expiry is now write-free; provider-owned session housekeeping is separate.

## 6. Validation / body / query bounds

Exact JSON MIME with allowed parameters, actual streamed 16KiB limit, early length rejection and fatal UTF-8. Strict Zod schemas reject unknown fields, mass-assigned IDs/status/scores/moderation metadata, unsupported query filters and invalid money/time/IDs. List/candidate bounds remain 30/50 and 200 as appropriate. UUID marketplace cursors remain distinct from provider User IDs. Case/chat/audit cursors retain scope checks; singleton/mutation query extras are denied.

## 7. XSS / Unicode / content safety

React plain-text escaping remains the rendering boundary; no application raw HTML, arbitrary URL fetch, local path, upload or external notification link surface. Shared text checks cover Vietnamese NFC/NFD, combining marks, malformed surrogates, controls/invisible-only input and CRLF. HTML/event payloads remain escaped text. New ingress does not change version 1 immutable text decoding; a regression preserves historical CRLF/control text readability. No content rewrite or invented rich-text feature.

## 8. Security / cache headers

CSP limits sources, blocks objects/framing and constrains form/base; production has no unsafe-eval. Inline scripts/styles remain explicitly allowed for Next bootstrap, so this is not a nonce CSP. Development adds eval/websocket support. Permissions-Policy disables unused capabilities; nosniff/framing/referrer controls remain. Sensitive pages/APIs including auth/account are no-store/no-referrer. HSTS defaults off; only ENABLE_HSTS=1 plus production HTTPS build opts into one-year HSTS without preload/subdomains. Unit/dev HTTP/production HTTP checks passed; no full browser E2E claim.

## 9. Rate limits / abuse resistance

Central rules and one atomic PostgreSQL statement cover concurrent first insert/reset/increment using DB time. Auth provider budgets remain; message 60/user/minute and 30/user/conversation/minute; report 10/user/hour; draft create/duplicate 60/user/hour. Dedupe/replay returns before charging; authorization precedes business allocation. Apply/review uniqueness, offer state and publish quota already constrain their flows. Keys derive from authorized identities/relationships or provider-normalized IP/allowlisted endpoint, not free text. Auth pruning no longer touches business counters; future namespace-specific managed maintenance/trusted proxy verification remains D7/D8/Phase 12.

## 10. Error handling

Seven public codes stay allowlisted. Expected constraint/transient conflicts become CONFLICT; unknown errors/timeouts INTERNAL. Classifier traverses bounded adapter code chains, never error text. Safe DTOs contain no stack, SQL, cause, provider body or raw validation input. Request IDs are server-generated UUIDs. Production 403/missing-mail/private-session HTTP behavior was exercised.

## 11. Transactions / retry / lock order

DB-only domain callbacks use max three complete fresh-transaction attempts for 40001/40P01/P2034, with modest jitter; no authorization/validation/unique-conflict/timeout/unknown-commit retry. Auth/email remain outside the helper. Wait 5s, transaction 10s (existing matching/moderation 15s), pg statement 10s/idle transaction 20s. Canonical actor→owner→Job→Application→Offer→Engagement and owning-tail locks remain; sorted admin User locks and transaction-scoped deterministic Worker advisory lock remain. Genuine two-connection deadlock and injected SQL aborts verify bounded recovery/rollback. Existing quota/capacity/status/block/review/moderation races pass.

## 12. DB integrity / constraints

Historical unique/partial unique/FK/check/immutability/audit-effect triggers retained. Marketplace historical relations use RESTRICT; auth/session and subordinate profile cleanup cascades are deliberately separate. No reset/drop/truncate route or production package command added. Hardening SQL checks zero accepted Offer/Engagement mismatches, duplicate pending/lifetime applications, wrong completed-review targets and orphan Job/User/Review/Engagement audit pointers. Faults after actual acceptance/message-notification/review/audit writes roll back all primary state, budgets and effects. No migration needed.

## 13. Query/index/performance review

Hardening uses 240 synthetic drafts, 40 Workers and 2,001 Messages; matching's existing suite separately exercises 203 eligible candidates capped at 200. Measured inbox queries: 17 for one and thirty rows; admin list 5; reputation 2 for one and forty subjects. Matching remains 26 for one and 200-candidate pool. Guards permit small fixed overhead, not brittle route-wide exact counts. Insert-between-pages tests preserve keyset behavior and chat scope. Five EXPLAIN JSON checks show index-capable FTS, capacity, message, reputation and moderation queries with sequential scans disabled; these do not claim naturally chosen plans, production benchmark or SLA. Initial hardening run reached plan checks in about 6.5s on local PostgreSQL; hardware/cache differ. No speculative index added. UTC/database clocks, exact VND strings/BigInt-safe DTOs, deterministic DST/uncovered-schedule behavior and bounded JSON snapshots remain covered.

## 14. Logging / privacy

Static actions, opaque IDs, outcome, server request ID and duration only. Immutable DB AuditEvent is authoritative, and reason/detail/body/token/PII never added to stdout logs. Email uses fixed Resend endpoint and JSON payloads/server-derived provider recipients, not user header construction. Voluntary personal text is not automatically redacted. Tracked/new files and generated public chunks receive credential/artifact checks before staging; no local env/client/binary/test data is deliverable. Legal retention/anonymization remains D7; monitoring remains D9/Phase 11.

## 15. Dependency / supply-chain review

pnpm audit --json returned exit 1: **3 high, 1 moderate, 0 critical**. See SECURITY for exact advisory links and reachability reasoning. deepmerge-ts cyclic-object issue is through Prisma config tooling (major fix); mysql2's two protocol issues are unused in this PostgreSQL-only application; braces affects dev glob patterns and has no reported fix. No known reachable high/critical request path found; advisories remain outstanding, not declared fixed. Pins/lockfile, allowed install scripts, readonly CI and persist-credentials:false are preserved; no dependency changes.

## 16. Environment / test / production safeguards

All test helpers require explicit TEST_DATABASE_URL, disposable marker, test-designated database name and nonproduction parent; no DATABASE_URL fallback or hostname assumption. Local validation used newly initialized isolated PostgreSQL 18.6, all ten migrations and owned transient fixtures. Actual production child runs built next start without dev mail preload/provider credentials, checks real session/cookies/login/account/logout and safe missing-mail failure. Strong secret/origin config is lazy so public build needs no credentials; production rejects loopback auth origin. Local/CI/preview/production separation and managed TLS/pooling expectations are documented. Provider setup, TLS/proxy/backup/load/retention signoff remain unverified operational work.

## 17. Tests

| Check | Local result |
|---|---|
| pnpm install --frozen-lockfile | PASS; lockfile unchanged |
| Prisma validate | PASS |
| lint / typecheck | PASS |
| unit | PASS; 427 tests, 17 files |
| build | PASS; actual production build |
| migration deploy/status | PASS; ten applied, subsequent deploy no-op |
| DB smoke | PASS; transient User rolled back |
| Phase 2 / 3 / 4 / 5 regression | PASS each; real PostgreSQL |
| Phase 6 / 7 / 8 / 9 regression | PASS each; includes populated Phase 8→9 upgrade |
| Phase 10 PostgreSQL hardening | PASS; real DB, abort/deadlock/fault/rates/plans/integrity |
| HTTP hardening | PASS; actual Next development HTTP with isolated mail transport |
| concurrency/race tests | PASS; quota/capacity/status/reviews/messages/reports/case close |
| production next start smoke | PASS; no HTTP mail preload/deployment |
| dependency audit | FAIL; four outstanding transitive advisories classified above |
| secret/artifact scan and staged diff | PASS; only documented placeholders and CI-only DB credentials matched, exact task credential absent from eligible files/public chunks |
| GitHub Actions | Pending publication at document creation; see delivery receipt |

The existing pg deprecation warning about overlapping client.query calls remains nonfatal with the pinned pg version; no unsupported pg 9 migration was attempted. No missing DB was disguised as passing.

## 18. Deployment compatibility

Durable sessions/rates/marketplace/audit live in PostgreSQL; no developer filesystem, instance-memory counter, local lock/daemon, persistent thread or new timer-based workflow. Bounded retry sleeps last milliseconds within requests. The eventual managed site remains independent of a running developer PC. Actual provider pooling/TLS/Next after/trusted proxy behavior still requires environment verification. No deployment or production readiness claim.

## 19. Files changed

Shared DB failure/transaction helpers, security rate/header/tests and text validation; existing auth/company/profile/job/hiring/matching/chat/review/moderation contracts/services and marketplace adapter; test DB guard, new hardening/production scripts and existing integration fixture cleanup/HTTP checks; next config, package scripts, CI, env example and AGENTS/ARCHITECTURE/DATABASE/SECURITY/ROADMAP/README/this report. Exact published diff is the GitHub commit. No historical product/report/migration or dependency-lock changes.

## 20. Deviations / unresolved risks

No schema or safe-relevance dependency change was justified. Four audit advisories remain with explicit reachability assessment. CSP retains inline bootstrap; HSTS is operator build-time opt-in. EXPLAIN fixtures prove index access, not production sizing. Actual browser interaction, provider TLS/pool/load/proxy and real email delivery were not certified. Broad namespace pruning is intentionally absent; managed retention/cleanup design remains deferred. Existing provider session housekeeping is not treated as a marketplace GET mutation.

## 21. Remaining blockers before Phase 11

User review/explicit authorization is required before Phase 11. No known unresolved reachable critical/high application finding was identified in this scoped review. D7 legal retention/anonymization, D8 operational access/secrets/TLS/backups/provider outages/proxy/maintenance, and D9 analytics/PII/metrics decisions remain deferred. They are not silently implemented or claimed approved. Production readiness requires Phase 12 and separate deployment authorization.

## 22. Git commit / remote CI evidence

Publication follows staged security/diff review on current main without force push. The implementation SHA and exact remote CI run are recorded in the publication receipt after GitHub executes this version; local checks are not a remote CI PASS claim. Stop after Phase 10.
