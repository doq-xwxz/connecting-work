# Phase 6 — Search and deterministic matching review

Implementation/review: 2026-10-08. PRODUCT and approved Phase 0–5 reports/migrations are preserved. This report records the authorized Phase 6 scope only; Phase 7 and deployment are not started.

## 1. Phase 6 Summary

Implemented PostgreSQL Job FTS, bounded composable filters/keyset pages, pure deterministic Worker↔Job matching, private Worker/Employer recommendations with explanations/coverage and immutable minimal match-at-apply metadata. Existing hiring/ownership/quota and auth flows remain authoritative. Local checks, real disposable PostgreSQL/Next HTTP and both GitHub Actions jobs passed; verified implementation publication evidence is recorded in §22.

## 2. D1 matching decisions resolved

Versioned covered-weight normalization replaces the Phase 0 proposed priors for this authorized implementation. Required skills use existing level gates; required skills count twice optional skills in scoring. Recurring whole-hour windows use half-open overlap; identical zones compare local recurrence, differing zones compare a declared reference week conservatively. Coarse city/mode policy, explicit unknown components, exact rational arithmetic, integer half-up rounding and bounded-pool tie order are resolved. Missing compensation/experience/reputation is not inferred. Future reputation/compensation/experience definitions, D5/D7 and Phase 11 analytics remain deferred. No PRODUCT or historical report is rewritten.

## 3. Search architecture / PostgreSQL FTS

PostgreSQL 18 UTF8, generated STORED searchVector, partial PUBLISHED-only GIN. Index title with A weight and description with B; controlled skills stay relational. NFC normalization and explicit pg_unicode_fast Unicode lowercase happen before `simple` tokenization. This fixes uppercase Vietnamese under database locale C; merely passing a collation into to_tsvector did not lowercase those characters in the actual local test. The reviewed built-in Unicode case mapping is documented by [PostgreSQL](https://www.postgresql.org/docs/18/collation.html).

Vietnamese Unicode words are supported, but accent folding, perfect Vietnamese stemming, substring/fuzzy search and Skill-name FTS are not implemented. Query is bound plainto_tsquery, never raw operator syntax. Strict q ≤200 raw characters/20 normalized whitespace-delimited tokens; unknown/duplicate query keys, control/operator syntax and malformed/oversized cursors fail safely. Empty q lists PUBLISHED ads. Filters compose city/type/mode/category/skill plus exact VND range overlap with explicit compensation unit; no cross-unit conversion.

Public order: R=round(ts_rank_cd(vector,plainQuery)×1,000,000) descending, publishedAt descending, stable ID ascending. Empty q has R=0. Typed base64url cursor carries version, normalized-filter SHA256, rank/time/ID; it is a position, not an auth token/signature. Final public DTO hydration rechecks PUBLISHED and exposes no vector/rank internals or private hiring/contact/account data. Public search rank is independent of Match Score.

## 4. Matching algorithm V1

Let wᵢ be configured weights (sum 100), xᵢ an exact rational normalized component in [0,1], C the set of measured/applicable components, W=Σᵢ∈Cwᵢ. Coverage=round(100W/100)=W. For eligible input and W>0, Score=round_half_up(100×Σᵢ∈C(wᵢxᵢ)/W); otherwise Score=null. Unknowns are excluded from both numerator and covered denominator, retained in configured total for coverage. All final arithmetic is positive BigInt rational; no rounded component feeds the final score.

Each component returns key/weight/covered/score/null/weightedContribution/null/static explanation. Component score=round_half_up(100xᵢ); weightedContribution=round_half_up(100wᵢxᵢ)/100 (configured percentage points, two decimals). These displayed rounded contributions need not reproduce the exact final rational. Explicit computedAt is part of input/output. Relevant-match checks use the returned final integer score.

## 5. Eligibility

The pure scorer separates eligibility from compatibility: matchable Job status PUBLISHED/PAUSED, name/minimum profile and existing Job-specific PART_TIME/TEMPORARY/SHIFT availability requirement; required skill absence/below level denies. Safe distinct reasons include JOB_NOT_MATCHABLE, WORKER_PROFILE_INCOMPLETE, MISSING_REQUIRED_SKILL and BELOW_REQUIRED_SKILL_LEVEL. Optional skills never hard-deny; location/pay/partial overlap are not new gates.

Services independently enforce fresh ACTIVE roles/profile, current ownership/membership, discovery opt-in and self exclusions. Worker recommendations only use PUBLISHED Jobs and exclude prior lifetime Applications. Recommendation eligibility is advisory compatibility, not guaranteed remaining capacity or email authorization. Phase 5 apply/accept still recheck fresh verification, current status, required skills, owner exclusion, Job state and actual occupied Engagement capacity under canonical locks. A high score never overrides these checks; low score/coverage never newly denies apply.

## 6. Component scoring

| Component | Weight | Exact implemented policy |
|---|---:|---|
| skills | 35 | Level values BEGINNER=1, INTERMEDIATE=2, ADVANCED=3, EXPERT=4. Per skill r=min(actual/target,1), absent=0. Required coefficient 2, optional 1; x=Σ(coefficient×r)/Σcoefficients. Higher proficiency caps at full. No Job skills means uncovered. |
| availability | 20 | x=unique overlapping recurring minutes / unique requested Job minutes. Windows [start,end), weekdays 0–6; no Job schedule or no Worker availability means uncovered. Same zone compares recurring local minutes. Different zones convert to weekly UTC minute sets using stable IANA offsets in Job-start week, otherwise computedAt week (Sunday UTC reference). Offsets checked hourly including week boundary; a differing-zone DST transition makes this component uncovered. Cross-week wrap and fractional-hour zone offsets work. No calendar reservation or exact-date availability claim. |
| location | 15 | REMOTE=1 iff Worker accepts REMOTE. ON_SITE=1 iff normalized city matches and Worker accepts ON_SITE. HYBRID=1 iff city matches and Worker accepts HYBRID or ON_SITE. Measurable mismatch=0, never ineligible. Missing mode/preferences or required coarse city means uncovered. No district/GPS/distance claims. |
| compensation | 10 | Uncovered: no formal Worker expectation/privacy data model; no salary inference. |
| experience | 10 | Uncovered: no formal comparable related-experience requirement/history; no bio parsing. |
| rating | 5 | Uncovered: trusted Phase 8 aggregates do not exist; no invented neutral/perfect/zero rating. |
| reliability | 5 | Uncovered: approved trusted response/completion denominator/window not yet implemented. |

## 7. Missing-data / coverage behavior

Known absence of a listed optional skill is measured zero; missing optional availability/pay/experience/reputation stays unknown. Uncovered does not mean low ability. Current maximum measurable coverage is 70%; no schedule normally yields at most 50%. Perfect known skills/location may yield Score=100 and Coverage=50, which is explicitly not a Relevant Applicant. UI always pairs numeric score with coverage and explains normalization/missing data; profile completeness is separately shown. No priors, automatic missing-data bonus, bands or hiring-probability claim.

## 8. Match score / rounding / versioning

Single deeply frozen weights config: weightsVersion=v1, algorithmVersion=deterministic-v1. Exact positive rational final half-up rounding produces 0–100 integer score; coverage is integer configured covered weight. Tests cover exact 62.5→63 and 87.5→88. Results are identical for identical inputs/evaluation time; no random term, AI, implicit clock or floating-point tie sort. Availability reference week can change with explicit computedAt when no startDate exists, as disclosed. Future material formula changes require a new reviewed version; immutable historical snapshots keep their original versions/time.

## 9. Relevant-applicant rule

One shared exported isRelevantMatch: eligible AND score!==null AND final score≥70 AND coverage≥60. Boundary tests cover 69/70 and 59/60, null and ineligible. This is a foundation predicate; no KPI dashboard, liquidity cohort/window calculation or Phase 11 implementation.

## 10. Worker recommended Jobs

ACTIVE WORKER + own WorkerProfile. SQL limits to PUBLISHED, excludes personal/current Company-owned Jobs and already-applied Jobs, and prefilters unmet required skills using controlled levels. At most 200 ID-ordered Jobs are hydrated in batches; pure eligibility is rechecked. Eligible results rank by returned score descending, coverage descending, ID ascending, max 30/page (default 12). Incomplete profiles return no eligible suggestions plus completeness. Neither city nor missing optional skills are hard-prefilters. No arbitrary Worker ID input exists.

## 11. Employer candidate recommendations

ACTIVE EMPLOYER + EmployerProfile + current personal/Company management. User→owner→Job locks recheck Company membership, including departed creator denial; only PUBLISHED/PAUSED Jobs permit candidate recommendations. SQL target conditions require discoverable=true, ACTIVE, WORKER, no current self/Company ownership and qualifying required levels. At most 200 profiles are hydrated in batches, eligible results ranked/paged as above. Applied opt-out Workers are omitted here and remain visible only through their scoped Phase 5 Application. ADMIN has no bypass, opt-in defaults remain off.

## 12. Application match-at-apply snapshot

Implemented inside the existing apply transaction after eligibility/capacity: eligibleAtApply, scoreAtApply, coverageAtApply, weightsVersion, algorithmVersion, matchedAt. Database column names use match-prefixed fields. No detailed Worker components/schedule or Offer/Engagement terms changes. SQL CHECK enforces all-null historical or coherent bounded snapshot; trigger freezes all six fields. Legacy Applications stay null, including after read/status changes; no backfill from mutable profiles. Existing self/current-management hiring query DTO exposes minimal matchAtApply safely and is the server query foundation for later analytics. Tests verify unchanged metadata after profile/Job description/close/pipeline changes and through real HTTP completed hiring. Client match metadata injection is rejected.

## 13. Privacy / authorization

Public Job DTO remains allowlisted; candidate DTO reuses safe WorkerDiscovery plus completeness/score/coverage/static explanations. No identity userId, contact/email/phone, bio, exact address, raw weekly windows/timezone, account/moderation/session/verification or invented pay history. Only coarse overlap percentage is exposed. Actor/owner/role/status/opt-in and path scope derive from fresh server reads, never cursor or score. Unknown fields, arbitrary Worker-ID query/scoring routes and out-of-scope Job requests fail safely. Existing exact-origin writes, no-store/no-referrer and safe errors/logging remain. Query-count instrumentation counts events only and never prints SQL/params/profile data. No shared authorization/result cache.

## 14. Routes/UI

Enhanced `/jobs?q=…` with keyword, city, type/mode/category/skill selector and comparable compensation range. New `/worker/jobs/recommended` and `/employer/jobs/[jobId]/candidates`; links from marketplace navigation and Job management. Authenticated GET APIs `/api/marketplace/worker-recommendations` and `/api/marketplace/employer-jobs/:id/candidates`. Strict query contracts allow only bounded limit/cursor for recommendations. No invitation/chat/upload action or arbitrary score endpoint. Server components keep DB/services off client bundles, use semantic labels/links/details and show “Mức độ phù hợp”, coverage, completeness and all seven components without bands.

## 15. Database migration/indexes

New additive `20261008060000_search_matching`; all six approved migrations unchanged. Generated FTS + partial GIN, six nullable Application metadata columns, coherent CHECK, immutable UPDATE trigger/function. SQL owns unsupported derived tsvector/index outside ORM write inputs; preserve them when reviewing future schema diffs. No external daemon, new package, pair materialization or destructive data rewrite.

Fresh: all seven migrations applied on new disposable PostgreSQL 18.6. Upgrade: separate disposable DB built with the six historical SQL migrations, baselined using migrate resolve, then representative pre-Phase-6 Unicode Job/Application inserted before db:deploy applied only the new migration. Existing Job indexed and old Application stayed null; status up-to-date and repeat deploy no-op. This rehearsal used ignored temporary scripts/credentials, never production or shared data. Production migrations still need separately authorized operational execution and normal lock/backup planning.

## 16. Performance bounds

Search hydrates limit+1 ranked IDs then at most 30 public DTOs; no wildcard ILIKE primary path. Matching fetches a hard 200 SQL-prefiltered IDs with batched nested relations, then scores at most 200, returns 30. A real fixture with 203 eligible candidates paged exactly 200 unique results; query events measured 24 for one candidate and 24 for the 200-candidate pool. Request-local timezone/week memoization avoids repeated zone conversion within the batch. No all-pairs table or N+1 component queries.

This is ranking within the first 200 eligible-prefiltered IDs, not a global best-match claim. Cursors page this current pool by score/coverage/ID and are bound to actor/Job/version; mutable profile/Job/opt-in changes can reorder/omit results. No snapshot pagination or enumeration of all excluded 201st+ candidates is promised. Tiny Job fixtures verify GIN catalog/validity and index-capable EXPLAIN; the optimizer may choose the status btree rather than GIN. No production latency/load/SLA or public abuse budget is claimed solved.

## 17. Tests

Final local results on Node 24.20.0 / pnpm 11.25.0 / actual PostgreSQL 18.6:

| Check | Status | Evidence |
|---|---|---|
| install | PASS | pnpm install --frozen-lockfile; lockfile/dependencies unchanged |
| Prisma validate | PASS | pnpm db:validate; schema valid |
| lint | PASS | pnpm lint, no warnings/errors |
| typecheck | PASS | Prisma generation + Next typegen + strict tsc |
| unit | PASS | 13 files / 303 tests, including 42 matching/search cases |
| build | PASS | Production compile/types/routes without runtime credentials |
| migration deploy/status | PASS | Fresh seven-migration chain, existing-data upgrade, current status and repeat no-op |
| db smoke | PASS | Real Prisma transient User CRUD, rollback |
| Phase 2 regression | PASS | Actual PostgreSQL auth/verification/reset/session/roles/status |
| Phase 3 regression | PASS | Profiles/company/privacy/opt-in and observed revocation/suspension races |
| Phase 4 regression | PASS | Job ownership/quota/lifecycle/constraint and race checks |
| Phase 5 regression | PASS | Required eligibility, immutable revisions, capacity/expiry races, obligations/cleanup/material guards |
| Phase 6 PostgreSQL integration | PASS | Scope/status/opt-in, score/coverage, snapshot immutability/legacy null, coarse location, optional/required levels, current/departed management and real 203→200/30 bounds/query counts |
| FTS tests | PASS | Unicode weighted title/description, updates/state visibility, composable filters, pay units, keyset pages, invalid syntax/cursors/injection and index catalog/EXPLAIN |
| HTTP tests | PASS | Actual Next/Better Auth/PostgreSQL Phase 2–6 routes/pages, privacy/IDOR/opt-out, apply metadata injection, match snapshot and score/version UI; only test email intercepted |
| GitHub Actions | PASS | Exact implementation SHA/run verified; checks and postgres-auth both completed success, see §22 |

Earlier local failures were resolved: uppercase Vietnamese under locale C required explicit Unicode lowercasing; tiny-fixture plan expectation incorrectly demanded GIN over another valid index. Authored tests were rerun on the repaired implementation. pg 8.23.1 adapter emits the known nonblocking concurrent-client-query deprecation warning also present in prior phases; no dependency upgrade or suppressed failure. This is not a browser automation/production penetration or load test.

## 18. Deployment compatibility

Runtime remains managed Node/Next + injected env + cloud PostgreSQL 18 UTF8 + configured email provider, independent of developer PC. Search/matching require no local daemon/files/Redis/ML/external index or cron; pure scorer runs on server requests. Builds/landing remain credential-free. Temporary local PostgreSQL is test-only and removed after verification. Provider pooling/TLS/origin/rate/backup/release setup remains operational work, not a deployment claim. No deployment performed.

## 19. Files changed

Governance: AGENTS, ARCHITECTURE, DATABASE, SECURITY, ROADMAP, README, PHASE_6. Tooling: package.json matching script and CI matching step; pnpm-lock.yaml/dependencies unchanged. Database: schema + one new migration. Search: jobs/contracts, service, search, pages; safe q field error allowlist. Matching: algorithm/unit tests/service/pages and two thin app pages. Hiring: transaction scorer call and minimal scoped projection. Transport/navigation: marketplace route and profile navigation. Verification: matching-integration and extended auth-http. Generated client/build/cache/temp DB/credentials are ignored and excluded. PRODUCT and Phase 0–5 reports/migrations untouched.

## 20. Deviations / unresolved decisions

Title/description-only FTS deliberately avoids a cross-table Skill trigger graph; relational Skill filter remains available. PostgreSQL 18 UTF8 minimum is explicit for stable built-in Unicode case mapping. Differing-zone DST transition weeks are conservatively uncovered, not incorrectly compared as equal local hours. Compensation/experience/rating/reliability remain unmeasurable until their proper data/privacy/reputation phases. Fixed first-200 ranking and live-page reorder are disclosed; global best-match ranking, accent folding, exact-date calendars, production load/rate budgets and later analytics are not claimed. D5/D7 and Phase 7 remain untouched.

## 21. Remaining blockers

No unresolved implementation, local test, publication or CI blocker. Production deployment/operational setup and future components are outside this authorization, not fabricated PASS results. Temporary PostgreSQL binaries/data/credentials were removed after its process stopped and the absolute cleanup target was verified. Stop at Phase 6 review.

## 22. Git commit / remote CI evidence

Implementation commit: [`e54b4c2c26669c934b175c37579584b013d02d6c`](https://github.com/doq-xwxz/connecting-work/commit/e54b4c2c26669c934b175c37579584b013d02d6c), pushed to current main. `git ls-remote origin refs/heads/main` returned that exact SHA. [GitHub Actions run 37726444119](https://github.com/doq-xwxz/connecting-work/actions/runs/37726444119) returned head_sha matching it, status=completed, conclusion=success; both checks and postgres-auth completed success, including the new matching and extended HTTP steps.

Reviewed 28 staged files, formulas, SQL bindings/indexability, scope/DTOs and bounds; diff --check passed, historical PRODUCT/reports/migrations and pnpm lockfile unchanged. Secret-pattern scan had no matches; ignored credential/env/generated/cache/test data paths were absent from staged/tracked changes. The first push hit a transient network disconnect; normal retry succeeded, without force or history rewrite. This documentation-only follow-up records observed evidence; its final remote head/CI are verified separately in the task delivery. No deployment or Phase 7 work occurred.
