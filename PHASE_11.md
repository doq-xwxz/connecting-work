# Phase 11 — Analytics + Monitoring

Authorized by the user's 2026-10-10 request after approval of Phases 0–10. No Phase 12, production provider provisioning or deployment. PRODUCT, PHASE_0–10, historical migrations and dependency lockfile are preserved. Base: ac099958274d092276fe3d0f12d2a51826e3736c on main.

## 1. Phase 11 Summary

Implemented aggregate PostgreSQL metrics, a minimal ADMIN dashboard/API, privacy-safe server events after commit, provider-neutral Noop analytics/error/monitoring interfaces, coarse operation durations, public liveness/readiness and real PostgreSQL/HTTP verification. Domain tables and immutable business audit remain authoritative. No SDK, provider secret, raw event table, outbox, cookie, replay or client analytics.

## 2. D9 decisions resolved

Metrics definition version `marketplace-metrics-v1`:

- Origin: existing Job.publishedAt is first successful publication; transitionJob sets it only when absent. Resume preserves it; live test verifies this. No duplicate firstPublishedAt field/backfill.
- Application time: actual schema field is appliedAt, not the request's illustrative createdAt. No schema rename or historical rewrite.
- UTC instants; requested range [start,end), max 366 days. All facts share one read-only RepeatableRead snapshot and database transaction time. Future timestamps do not count. Default dashboard range is 30 UTC days through the next UTC midnight; future portion is capped by snapshot time.
- Observation: first publication in range and publishedAt+24h <= asOf. Draft-only/unpublished and immature Jobs are excluded. Relevance window is inclusive [publishedAt,publishedAt+24h]. Applications after 24h do not count.
- Exclude a published Job cancelled within inclusive 5 minutes only if it has zero lifetime Applications. With even one application it remains; a cancellation beyond 5 minutes remains. Using zero lifetime rather than a time-window counter is conservative and rebuildable. Ordinary trusted writers cannot create Applications after terminal cancellation.
- Keep PAUSED, CLOSED, COMPLETED and moderation-hidden Jobs, including early close/hide. There is no historical exposure measurement sufficient to assert no meaningful public exposure; hiding cannot conveniently erase a poor cohort. No mutable hiddenAt or creator/status filter changes the cohort.
- Test/system data belongs only in explicitly disposable environments. No production isTest flag or guessed fixture-name filter is added.
- FORCE_COMPLETE counts as COMPLETED with explicit audited provenance. Forced cancellation is separated in cohort outcome counts. No punitive score is introduced.
- Existing terminal Engagement history cannot reverse. If future authorized corrections/reversals are introduced, metric definition/version must be reviewed; no fabricated reversal ledger now. All later outcome facts are as of the snapshot, not eventual conversion promises.

## 3. North Star definition

Successful Match = Engagement.status COMPLETED. Count distinct Engagement rows whose completedAt is in [start,end) and <= asOf. `completedTotal` includes all such rows; `completedForced` requires its moderationAuditId to resolve to the exact same resource/ENGAGEMENT with ENGAGEMENT_FORCE_COMPLETED; `completedOrganic = total-forced`. Never infer from missing Worker completion request, event counts, messages or Offers. Audit-effect guards already ensure valid provenance. Admin cannot edit metrics.

## 4. Liquidity KPI definition

Denominator: fully observed first-publication Job cohort after the exact exclusion rule above. Numerator: denominator Jobs with >=3 Applications in their first inclusive 24h whose immutable matchEligibleAtApply=true, score>=70 and coverage>=60. Shared exported relevanceThresholds are also used by isRelevantMatch; no copied threshold literals in SQL.

Historical null snapshots fail qualification; valid v1 and deterministic-v2 snapshots count without recomputation. Existing schema permits eligible=true or coherent historical null only; explicit false is rejected by its unchanged constraint. Low score/coverage do not qualify. Withdrawal/rejection/later profile edits do not erase an actual received Application. Lifetime job/worker uniqueness already prevents duplicate applicant inflation. Target 50%; DTO retains numerator/denominator integers and percentage rounded to one decimal. Zero denominator gives null, never zero success.

## 5. Funnel metrics

Activity window uses separate explicitly named time bases:

| Metric | Domain time / meaning |
|---|---|
| publishedJobs | first Job.publishedAt in range, including immature/excluded liquidity rows |
| applications | Application.appliedAt in range |
| acceptedOffers | Offer status ACCEPTED, resolvedAt in range |
| engagementsCreated | Engagement.acceptedAt in range |
| completedTotal/Organic/Forced | Engagement.completedAt in range, as above |

Application cohort funnel: Applications with appliedAt in the selected range. Subsequent facts are observed as of the same snapshot, including steps after range end. Shortlisted means explicit shortlistedAt exists; direct Offer creation does not manufacture an earlier shortlist. Offered means at least one actual Offer row, not revision count. Accepted means its unique Engagement exists. Started means startedAt exists. Completed/cancelled mean current terminal status, with explicit organic/forced and participant/forced counts. Shortlist/application, offered/application, accepted/offered, started/accepted and completed/(completed+cancelled) ratios each expose numerator/denominator/null handling. Outcome ratios include both provenances and UI says so. Published Jobs activity is shown alongside the funnel, never used as an Application conversion denominator. Cohort maturity bias is visible; no causal or eventual conversion claim.

## 6. Analytics event taxonomy

Every selected event is server-side and instrumented at the owning service's actual new write, not a route replay:

| Area | Events | Allowed properties |
|---|---|---|
| Job | job_created, job_published, job_paused, job_closed, job_cancelled | publication FIRST/RESUME only for published |
| Hiring | application_created, application_shortlisted, application_rejected, offer_created, offer_accepted, engagement_created, engagement_started, completion_requested | none |
| Outcomes | engagement_completed, engagement_cancelled | enumerated provenance |
| Chat | conversation_opened, message_sent | none |
| Reviews | review_submitted | direction enum; no rating/comment |
| Reports | report_created | target type enum; no reporter/target identity/reason/details |
| Moderation | moderation_action_applied | exact resource-action enum, AuditEvent UUID; no admin identity/reason |
| Search | job_search_performed | queryPresent boolean, resultBucket ZERO/ONE_TO_TEN/ELEVEN_PLUS |
| Recommendations | worker_recommendation_viewed, employer_candidate_recommendation_viewed | resultBucket only |

Suggested auth/profile/company completion events are intentionally not part of this selected v1 taxonomy. This avoids auth-token-page instrumentation and inventing a profile-completion lifecycle/idempotency ledger. They can be separately reviewed; no empty implementation or unsupported completion claim. No click tracking.

## 7. Event privacy / schema versioning

Strict runtime schemas reject unknown top-level/property keys, unknown names, malformed UUIDs and dynamic payloads. Static snake_case names, schemaVersion1, deterministic eventKey, opaque resource UUID/type, actorRole, occurredAt, environment and event-specific properties only. Actor/reporter/admin User IDs are omitted. Resource IDs are pseudonymous linkage data requiring review before external export, not anonymization. Search uses a fresh per-request UUID, no text/filter values/name/score breakdown. Jobs use version as occurrence ID to distinguish legitimate pause/resume cycles; immutable conversions use event/resource/once keys. Typed internal input and explicit projection prevent entity spreads.

No email/phone/IP/body/comment/report details/moderation reason/private schedule/compensation/token/session/raw query. No client SDK, replay, form/DOM capture, analytics cookies or fingerprints. Material payload evolution requires a new schema version and backwards compatibility review.

## 8. Analytics provider abstraction

AnalyticsProvider.capture(ProductEvent,AbortSignal) supports a later PostHog adapter mapping eventKey/resource pseudonym to provider identity/dedup fields. There is no selected external identity policy or network transport yet. Immutable Noop default; AsyncLocalStorage dependency injection scopes providers to an executing request/test only. No mutable global event store/session persistence. No SDK/env/dependency change or mandatory outbox. Adapters must honor AbortSignal and preserve this projection.

## 9. Error monitoring abstraction

ErrorReporter.captureException supports a later Sentry adapter. Only safeFailure INTERNAL goes through this boundary; VALIDATION/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/RATE_LIMITED do not. Construct a NEW static-message exception, static operation http_boundary, generated UUID requestId and INTERNAL code. Never forward original Error, message, stack, cause, SQL, arbitrary provider payload or input. One capture at the API failure boundary; adapter failure is swallowed without recursive reporting.

MonitoringProvider.observe receives static operation, outcome and coarse duration bucket (<100ms,<500ms,<2s,>=2s). Search, both recommendations, apply, Offer accept, message send, moderation action and readiness are instrumented. Durations include that operation's post-commit telemetry budget if an adapter is enabled; these are diagnostic buckets, not production SLA/alert thresholds. No raw resource/user/text context is attached.

## 10. Analytics failure isolation

Each database transaction attempt owns a volatile WeakMap intent buffer. Failed attempts/rollbacks discard it. Only the successfully committed attempt emits, outside the transaction/retry catch, so an adapter error can never retry committed business state. Idempotent domain replay returns before enqueue. Conversion keys are deterministic; providers are not assumed exactly once. One cooperative abort 100ms budget per event batch, bounded separately for error/duration hooks; both synchronous throws and rejected/hanging promises are contained. There is no detached timer/daemon or critical transaction network call. Delivery is intentionally lossy on interruption/network/provider failure. CPU-blocking malicious adapters cannot be preempted by JavaScript; only reviewed cooperative adapters may be installed. PostgreSQL KPI reconstruction remains correct without events.

## 11. Admin analytics dashboard/API

GET /api/admin/analytics requires start/end UTC ISO parameters; duplicate/extra fields and >366-day/reversed/invalid ranges fail safely. Fresh ACTIVE ADMIN is checked inside the read snapshot after real session authentication. Guest401, normal roles403, stale removed ADMIN403 and suspended ADMIN403. No user/company drilldown or arbitrary target filter. /admin/analytics is a dynamic server component with a UTC range form, count cards and accessible table; navigation is shown to ACTIVE ADMIN. Safe denial/invalid-range page and guest sign-in redirect. No client DB/provider imports. Private no-store/no-referrer and global headers retained.

## 12. Health / readiness

GET /api/health returns200 `{status:"ok"}` without DB/provider config. GET /api/ready probes PostgreSQL SELECT1 only and returns200 ready or503 unavailable. No URLs/env/schema/build/credentials/error details. no-store on both. Probe statement 1.5s, transaction 2s/acquisition 1.5s and response race 2.5s; default Noop monitoring adds no external dependency. Future injected monitoring has an additional bounded 100ms budget. Underlying connection acquisition remains bounded by the 5s pool timeout even if the response race already ended. Failed probes are handled promises, not leaked errors. Actual production smoke uses healthy disposable PG and a separate child with unreachable loopback endpoint. Optional email/analytics/error providers do not gate readiness.

## 13. Metric SQL / indexes / performance

SQL CTEs aggregate historical cohorts, relation-probed Offer existence and exact audited outcomes inside PostgreSQL. Only one count row leaves SQL. Read-only RepeatableRead with maxWait 5s/timeout 10s, no cache/materialized pair table/Redis. Existing Job/status-publication and relationship indexes support bounded fixture workload. Real 300-job scale test retains6 queries including BEGIN/SET/fresh role/clock/aggregate/COMMIT; representative EXPLAIN ANALYZE executes on actual PostgreSQL. These are correctness/query-growth evidence, not production sizing or proof of natural range-index selection. No speculative index/migration added; actual deployment cardinalities may justify additive time indexes in Phase 12.

## 14. Security / privacy

No analytics-backed authorization, ADMIN discovery bypass, new role or marketplace lifecycle. Current ownership/locks/verified-email/capacity/idempotency/rate/audit/history guards remain in owning services. Reporting instrumentation omits reporter identity and moderation reasons. Runtime strict allowlists and safe output, plain React escaping, private headers, read-only snapshot and bounded query apply. Test fixtures exist only in a disposable DB; test helpers never enter runtime. Dependency pins/lockfile and historical SQL unchanged. Existing four audit advisories remain classified in SECURITY; no claim of zero vulnerabilities.

## 15. Environment/provider configuration

No new env required or provider credentials used. Production default remains Noop. Build/static/unit checks need neither PostHog nor Sentry. Runtime metrics/readiness use existing DATABASE_URL; admin needs existing auth config/session. Tests require explicit TEST_DATABASE_URL, AUTH_TEST_DATABASE=disposable, test-designated name and nonproduction parent. No analytics debug endpoint or production fixture flag. Before external adapters: review consent/legal region/retention/access owner, pseudonymization, scrubbing, cooperative abort, delivery/loss expectations and provider secrets server-side. Real dashboards/alert channels are not provisioned now.

## 16. Tests

Execution evidence is updated after the final validation run; authored tests alone are not PASS. Real analytics tests cover lifecycle emissions after committed reads; replay dedup; rollback/confirmed-abort retry intent discard; throwing/hanging providers; safe INTERNAL-only monitoring; fresh/stale ADMIN; correct organic/forced source; first publication/resume; first 24h boundaries; score69/coverage59/null/v1/v2; later profile edits; paused/closed/early-cancel/hidden cohorts; start/end boundaries; immature and zero-denominator handling; hundreds of Jobs/fixed query count and EXPLAIN. Explicit false eligibility is rejected by the preserved DB contract rather than inserted through a weakened guard. HTTP tests cover sessions/role/status/range/duplicate query/privacy/cache/page/health/readiness. Production child verifies healthy/unavailable DB and safe503 without mail preload.

Local validation receipt (2026-10-10): PASS frozen install, Prisma validate, lint, typecheck, production build, migration deploy/status/repeat no-op and DB smoke. PASS each real PostgreSQL Phase 2 auth, 3 profiles, 4 jobs, 5 hiring, 6 matching, 7 messaging, 8 reviews, 9 moderation plus populated upgrade, 10 hardening, 11 analytics. PASS actual Next HTTP regression including Phase 11 ADMIN/range/privacy/cache/UI/health/readiness. PASS actual production next start including healthy/unreachable DB readiness, secure session/login/logout/CSP and safe missing-email failure, without dev mail preload. Unit tests: PASS, 435 tests across 20 files after the final reporter-failure regression. Real 300-job metrics query count 6, no per-row Node hydration. Real PostgreSQL 18.6 isolated cluster; ten unchanged migrations, no missing DB blocker. Dependency audit returns 3 high/1 moderate/0 critical, same reachability classification as Phase 10; audit is an outstanding FAIL, not a clean PASS. Staged diff and artifact/credential scan PASS: 223 eligible files and 21 public chunks excluded local credentials/server config/generated artifacts; implementation GitHub Actions run 38033807487 completed successfully with both jobs and every validation step successful.

## 17. Deployment compatibility (PC off)

Runtime durable facts are in managed PostgreSQL/env; no file event store, local service/worker/cron dependency, process-memory business metrics or PC-required delivery loop. The local PostgreSQL instance is test-only. All provider work is bounded/awaited within requests; lossy delivery does not gate business commit. Actual cloud pooling/TLS/proxy/provider/latency and operational alert routing remain unverified Phase 12 work. No deployment.

## 18. Files changed

New modules/analytics contracts/service/tests, shared/observability contracts/runtime/commit/tests, admin analytics page, health/ready routes and analytics PostgreSQL suite. Instrumented jobs/hiring/matching/messaging/reviews/moderation, safe HTTP failure boundary and existing admin navigation/API. Updated production/HTTP tests, package test command/CI and AGENTS/ARCHITECTURE/DATABASE/SECURITY/ROADMAP/README/this report. No PRODUCT/PHASE_0–10/schema/migration/dependency-lock changes. Exact published diff is the implementation commit.

## 19. Deviations / unresolved risks

Use appliedAt because it is the actual creation field. Keep hidden Jobs because exposure is unmeasured. Suggested auth/profile/company events are unselected, not stubbed. No external SDK/adapter/env or index added without need. Privacy-safe provider identity/region/legal retention/access, actual load budgets and alert thresholds/channels remain operational work. Events intentionally lossy; cooperative timeout cannot interrupt synchronous CPU stalls. Known pg overlapping-query deprecation warning is nonfatal on pinned version. Existing dependency advisories remain. No browser interaction/E2E accessibility certification, production service SLO or deployment claim.

## 20. Remaining blockers before Phase 12

User review/explicit authorization of Phase 12. D4 phone/public-release policy, D7 retention/legal/privacy, D8 operations/TLS/backups/restore/pooling/proxy/incident owner, and remaining D9 external provider identity/region/retention/alerts must be resolved in that scope. Suggested future signals: unexpected HTTP 500 ratio, measured operation/DB latency, readiness failures, migration failure, auth abuse spikes and moderation failures, using environment-specific windows/thresholds and approved response ownership. No fabricated threshold or external notification is configured. Dependency advisory follow-up remains required. No known missing local DB evidence is represented as success.

## 21. Git commit / remote CI evidence

Implementation committed/pushed on main: [888129ffac8e6882d828303fa333fce502a38103](https://github.com/doq-xwxz/connecting-work/commit/888129ffac8e6882d828303fa333fce502a38103). git ls-remote confirmed that exact origin/main SHA. [GitHub Actions run 38033807487](https://github.com/doq-xwxz/connecting-work/actions/runs/38033807487) completed success at 2026-10-10 07:18:56 UTC. Both checks and postgres-auth and every validation step were successful, including frozen install/schema/static/435 unit/build/migration/smoke/Phase 2–11/HTTP/production checks; none of those steps were skipped.

Before publication, 36 staged files passed diff/artifact/credential review. PRODUCT, PHASE_0–10, historical SQL/schema and dependency lock stayed intact. Local disposable PostgreSQL was stopped; its entire task-owned binary/data/random-password/env/log/audit directory was removed after validation. Working tree was clean after implementation push. No production DB, real email, external analytics/error provider or website deployment was used. This documentation receipt is a subsequent commit; its exact remote SHA/CI evidence is supplied in final delivery. Standing publication authorization applies; no force push/history rewrite. Stop after Phase 11.
