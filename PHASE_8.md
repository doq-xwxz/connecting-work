# Phase 8 — Reviews + Reputation

Review evidence, 2026-10-09 (Asia/Saigon). Phases 0–7 are approved. PRODUCT, Phase 0–7 reports, historical migrations and lockfile remain unchanged. Scope ends at Phase 8; no Phase 9 or deployment. Executed evidence and pending publication are distinguished below.

## 1. Phase 8 Summary

Implemented completed-work bilateral immutable reviews, stable Company/personal/Worker subjects, safe historical DTOs, visible rating aggregates, Worker outcome reliability, batched reputation facts and deterministic matching V2. Existing hiring/chat boundaries remain authoritative. No moderation/reply/payment/AI/cache infrastructure.

## 2. Review eligibility / direction

Only individual Engagement COMPLETED, irrespective of whole Job status. WORKER_TO_EMPLOYER targets Company when Company-owned, otherwise EmployerProfile. EMPLOYER_TO_WORKER targets WorkerProfile. Fresh ACTIVE relevant role and current Worker/personal ownership or current Company OWNER/MANAGER. ACCEPTED/IN_PROGRESS/CANCELLED deny. SUSPENDED/BANNED actor denies new reviews after work ends; block does not prevent eligible post-work review. No ADMIN bypass.

## 3. Review database model

Review stores Engagement/direction, actual internal reviewer User, WorkerProfile and exactly one Company/personal EmployerProfile, integer1–5 rating, optional plain-text comment, actor-bound creationKey, createdAt and future nullable hiddenAt. RESTRICT FKs retain historical parents. SQL insert guard verifies completed relationship, matching Worker/Job owner and current ACTIVE role/participant. No giant duplicate snapshot: reuse immutable Engagement terms for historical owner/Worker/Job display and completed timestamp.

## 4. Review immutability / idempotency

UNIQUE(engagementId,direction) consumes one logical side slot across all Company managers. User→owner→Job→Application→Engagement lock/recheck serializes writes. Same actor/key/normalized rating+comment returns the existing review after fresh authorization; changed payload/key/actor conflicts. All Review UPDATE fields, including hiddenAt, are frozen by trigger. No ordinary edit/delete/hide API. Trusted fixture operators may delete their rows; application users have no direct DB deletion authority. Future D7 retention and Phase9 hide require reviewed operational/migration work, never cascade account history.

## 5. Company vs personal employer review semantics

Company is the stable subject/author, not the manager/creator. First currently authorized manager wins Company-side slot; departure revokes further access/replay and does not transfer reputation. Personal history attaches only to its EmployerProfile and excludes Company provenance. Actual reviewerUserId remains internal accountability. Company/User renames do not rewrite Engagement-derived historical display. Current membership authorizes, creator provenance never does.

## 6. Review visibility / privacy

D3 subset: anonymous PUBLISHED Job detail exposes owner average/count/completed hires only, no comments/authors. Full owner comments require ACTIVE authenticated WORKER on a PUBLISHED Job-owner view. Worker reputation/comments require ACTIVE EMPLOYER/profile and opted-in ACTIVE WORKER discovery or current managed Application relationship. Existing hiring can read safe Worker reviews despite discovery opt-out; arbitrary review detail cannot. No public Worker directory/profile author navigation. Worker reviewers are generic completed-work authors; Company reviewers show safe historical Company display, personal reviewers historical public display. No reviewer User/profile/Company internal IDs, email/phone, auth, cancellation actor, creationKey, hidden metadata or raw terms DTO. Hidden rows excluded everywhere normal, including own relationship and matching.

## 7. Worker rating formula

Visible EMPLOYER_TO_WORKER reviews linked to valid COMPLETED Engagements only. Integer sum S/count N; UI average half-up to one decimal once, sample count shown. Matching exact normalized rational `(S-N)/(4N)` for N>=1; zero reviews uncovered. 1star→0, 3star→1/2, 5star→1. No prior, smoothing, text sentiment or artificial one-review penalty. `reputation-v1` versions the display/facts interpretation.

## 8. Worker reliability formula

Numerator C = all actual COMPLETED Worker Engagements. Relevant cancellation W = CANCELLED where cancelledBy equals that Worker's User ID. Denominator C+W; ratio C/(C+W), uncovered if zero. ACCEPTED/IN_PROGRESS excluded; employer-caused/other/ambiguous cancellation excluded, with no private actor identity returned. All recorded history, no invented time window or response-rate metric. Exact integer facts enter rational matching; UI ratio rounds once to four decimals and shows completed/relevantCancelled/sampleSize. Low sample is disclosed without invented confidence/prior.

## 9. Employer / Company reputation

Separate visible WORKER_TO_EMPLOYER aggregates per Company or personal EmployerProfile, plus actual completed-hire count. Company history remains after membership/creator changes and never mixes into personal employer rating. Employer cancellation attribution/completion-rate sophistication is deliberately deferred because departed-manager/future operational causation should not be inferred. No fabricated employer reliability/perfect ratio displayed or inserted into Worker matching. Suspension does not erase history; banned-public visibility remains D5.

## 10. Matching algorithm V2 integration

weightsVersion=v1; algorithmVersion=deterministic-v2. Weights unchanged35/20/15/10/10/5/5, total100. Rating adds5 covered weight when N>=1; reliability adds5 when C+W>=1. Maximum measurable coverage80%; compensation/experience remain uncovered. No-data behavior retains old normalization/score with new semantic version. Pure scorer receives facts explicitly, never queries DB. Exact positive BigInt rational final half-up rounding remains; rounded UI averages never feed final score. Relevant predicate remains eligible/score>=70/coverage>=60. Current candidate ranking uses V2, including measured cancellations, without stigmatizing labels.

## 11. Historical match snapshot compatibility

Old deterministic-v1 and legacy null Application snapshots remain untouched; no backfill. New applies calculate/store minimal V2 snapshot under existing eligibility/capacity transaction, even when reputation is uncovered. Later reviews/outcomes do not rescore earlier stored score/coverage/relevance inputs. SQL historical trigger still freezes all six match fields. Exact versions/time accompany snapshots for future reporting; Phase11 not implemented.

## 12. Review routes/UI

Completed Worker/Employer Application detail renders one-time labeled1–5 form/optional2000-character comment and then read-only reviews. Current Company slot shared across managers. No edit/delete/reply buttons or notification side effect. Full owner list `/worker/jobs/[jobId]/reviews`; opted-in Worker list `/employer/workers/[workerId]/reviews`; existing managed Application contextual Worker reviews. Public Job detail owner aggregate/completed hires, candidate recommendations safe rating/history and link. API GET/POST side-engagements/:id/reviews, authenticated GET jobs/:id/reviews and workers/:id/reviews; public GET jobs/:id contains aggregate only. Target-bound timestamp/UUID keysets20 default/max30. Review never reopens completed chat.

## 13. Reputation DTOs / query architecture

Server-only reviews service owns policies/transactions/projection. Hiring public review-query owns relationship scope without importing reviews service. Public reviews/query returns batched integer facts, with no service/UI/repository dependency cycle. One bound PostgreSQL statement aggregates both rating and outcomes from one statement snapshot for <=200 Workers. Matching/hiring pass these facts into pure scorer. Safe versioned reputation DTO has average/count and completed/relevantCancelled/sampleSize/numerical ratio. Owner DTO deliberately omits speculative reliability. Lists reconstitute allowlisted historical context, never serialize raw Prisma/snapshots.

## 14. Security / authorization

Real Better Auth sessions, fresh current roles/status, owner/member/resource state and DTO visibility on server. User NO KEY UPDATE→owner→Job→Application→Engagement; no second User lock, membership removal shares Company. Strict Zod input/query/path/UUID, exact Origin, JSON16KiB, no-store/no-referrer and safe static allowlisted field errors. Plain escaped comment, trimmed CRLF-normalized max2000 UTF-16; rejects unsupported controls, malformed surrogate and invisible-only. No raw HTML/Markdown/attachment or PII/body/SQL/token logging. Voluntary text is not automatic PII redaction. No ADMIN grant/override, moderation backdoor or production test preload.

## 15. Database migration / indexes

Additive 20261009080000_reviews, one enum/table, history FKs/uniqueness/scale/text/owner checks and completed-current-participant insert/immutable-update guards. Direction/hidden/time/ID indexes per Worker/personal/Company and reviewer index; partial personal Job owner index supports separated history. Prior eight SQL migrations and SQL-owned FTS preserved. Fresh nine migrations/status/smoke PASS; separate old-eight baseline with representative historical v1 Application/Unicode Job upgrades only new migration, preserves match/FTS/no unsolicited reviews. Repeat deploy no-op PASS. No db push/reset/SQLite/production URL.

## 16. Performance / batching

One batched facts statement independent of 1 vs200 Workers. Observed2 query events including transaction overhead for both sizes; Phase6 candidate suite now25 events for one and200-candidate pools. Hard candidate200/page30 bounds preserved; bounded review20/max30 keysets. No N+1 aggregates, materialized counter/cache/Redis or all-pairs table. Ranking stays within existing first200 pool, not global best match. No production latency/load/SLA claim.

## 17. Tests

Local Windows Node24.20.0/pnpm11.25.0 and real disposable PostgreSQL18.6 from [official EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries). Only email transport intercepted inside actual Next development HTTP child. Current executed evidence:

| Check | Status / evidence |
|---|---|
| install | PASS — frozen lockfile, no dependency changes |
| Prisma validate | PASS — db:validate |
| lint | PASS — application/source checks; ignored temporary test binaries excluded |
| typecheck | PASS — Prisma/Next generation and strict TS |
| unit | PASS —356 tests/15 files, including18 new validation/reputation/V2 cases |
| build | PASS — production dynamic review routes/SSR, no provider credentials required |
| migration deploy/status | PASS — fresh9, historical upgrade, current status/repeat no-op |
| db smoke | PASS — transient User rolled back |
| Phase 2 regression | PASS — real auth/token/session/roles/status/limits |
| Phase 3 regression | PASS — profiles/privacy/Company/races |
| Phase 4 regression | PASS — Job ownership/quota/lifecycle/constraints/races |
| Phase 5 regression | PASS — eligibility/hiring/immutable terms/capacity/obligations |
| Phase 6 regression | PASS — FTS/bounds/25-vs25 query counts/immutable apply facts |
| Phase 7 regression | PASS — chat/blocks/read/notifications/rates/obligations/races |
| Phase 8 PostgreSQL integration | PASS — completed eligibility/current roles/member/Company slot/immutable DB/target/privacy/hidden/outcomes/batch |
| matching-v2 tests | PASS — scale/exact averages/ratios/coverage/version/relevance/old v1 freeze/new V2 apply; final real ranking rerun PASS |
| HTTP tests | PASS — actual Next Phase2–8, completed forms/read-only result, retries/Company manager/departure, IDOR/origin/XSS/aggregate/private lists/V2/frozen apply |
| concurrency tests | PASS — same-key retries/opposite Company managers, observed actual Company/User wait then revocation/suspension |
| GitHub Actions | BLOCKED — automatic approval reviewer rejected Phase8 push; no remote Phase8 commit/run exists |

Known pg8.23.1 concurrent-client-query deprecation warning persists from earlier adapter use; assertions pass, no dependency upgrade. Hidden exclusion uses trusted test-only transaction disabling/restoring Review trigger, not application hide operation. Development TypeScript errors and lint noise from temporary vendor binaries were corrected before final execution. These are real HTTP/SSR tests, not browser interaction, provider deployment, penetration or production load evidence.

## 18. Deployment compatibility

CONFIRMED: managed Node/Next + env origin/secrets + cloud PostgreSQL18 UTF8 and existing auth mail provider remain independent of developer PC. All review/reputation state/locks in DB, computed on requests; no local filesystem/daemon/worker/cron/Redis/WebSocket/AI. Local cluster is verification only and removed after checks. Cloud TLS/pooling/proxy/region/backups/deliverability remain release-environment work. No deployment performed.

## 19. Files changed

Review module contracts/presentation/queries/service/forms/unit tests; hiring public review query and Application integration; matching scorer/service/UI/V2 tests and apply facts; two thin review route wrappers, explicit marketplace handlers/public Job trust display; Prisma schema/additive SQL; PostgreSQL review suite/extended HTTP cleanup; package/CI review command; ESLint excludes ignored .tmp binaries; AGENTS/ARCHITECTURE/DATABASE/SECURITY/ROADMAP/README/this report. No new package/lockfile, PRODUCT, approved reports/migrations, generated clients/build/env/credentials/test data.

## 20. Deviations / unresolved decisions

One overall PRODUCT1–5 rating, optional comment; no extra subcriterion scoring or unapproved response-rate/credit score. Owner completion count only avoids speculative employer cancellation causation. Review notifications deferred; existing NEW_MESSAGE unchanged. hiddenAt is schema-compatible but fully immutable until reviewed Phase9 trigger evolution, with no current hide/backdoor. Full ban-public visibility D5, retention/anonymization D7, invitation/contact/email/outbox/ops and compensation/experience remain deferred. No Phase9/admin/report/dispute/payment/AI/upload/deployment.

## 21. Remaining blockers

All local static/build/real PostgreSQL Phase2–8/HTTP/upgrade checks PASS. Publication and remote CI are BLOCKED: automatic approval reviewer rejected the ordinary main push twice, treating the latest attached Phase8 publication instruction as untrusted scope authorization and retaining the earlier Phase7 limit. Read-only evidence of attachment section67 was provided before the second attempt; no bypass/workaround or remote mutation occurred. Direct user chat approval is required to unblock publication. No known code/local validation blocker. Disposable server stopped and task-owned binaries/cluster/credentials/upgrade fixtures removed from verified absolute ignored workspace paths. Stop after Phase8 review.

## 22. Git commit / remote CI evidence

Base local/remote main340cd0c46b494627eede3e37a30e8ced411929b8. Local implementation commit7b14a6a323d62e175b8af64751f7dae723ce5c55 (32files,826 insertions/27 deletions) contains the reviewed and locally validated Phase8 implementation. Staged SQL/formulas/locks/current Company authority/DTO/XSS/client boundaries and diff --check passed. Pattern/actual disposable credential/client secret marker scans had zero matches; PRODUCT/approved reports/old eight migrations/lockfile unchanged and ignored env/generated/build/temp data excluded. Automatic approval blocked both ordinary push attempts, including the retry after reading explicit user attachment section67. Nothing from Phase8 has been pushed; no Phase8 remote SHA/CI success is claimed. Direct user chat approval is needed before another push. This local documentation follow-up records that blocker. No force push/history rewrite/deployment.
