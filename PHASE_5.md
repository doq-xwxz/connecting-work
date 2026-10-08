# Phase 5 — Applications, Offers and Engagements

Review report, 2026-10-08. PRODUCT and approved Phase 0–4 reports/migrations remain unchanged. Implemented scope ends at Phase 5; no deployment or Phase 6 authorization is inferred.

## 1. Phase 5 Summary

Implemented separate Application/Offer/Engagement entities, Worker/Employer workflows, immutable structured terms, transactional acceptance/capacity, ordinary work lifecycle, current ownership/privacy and dependent Job finalization. Runtime persistence and locking use PostgreSQL only. Local verification is recorded below; publication/remote CI evidence is finalized after the reviewed commit is pushed.

## 2. D2 decisions resolved

- New Apply requires PUBLISHED and available occupied capacity. Existing PAUSED hiring remains: offers may be issued to already shortlisted applicants and pending offers accepted. CLOSED forbids new Apply/Offers, never reopens and preserves valid pending acceptance. No other material recruiting expectation is silently relaxed.
- Decline/revoke/expiry returns only OFFERED, non-engaged Applications to SHORTLISTED. Reject with a pending Offer conflicts; revoke first. Withdrawal atomically revokes pending Offers and is terminal. List/detail never marks VIEWED; explicit action does.
- Either current party can cancel ACCEPTED/IN_PROGRESS work with category PERSONAL/SCHEDULE/TERMS/OTHER and 1–500 character reason. Store timestamp/actor/category/reason; keep history. No consent/dispute/admin force subsystem is invented.
- Employer starts; Worker requests completion; Employer confirms. Suspended parties retain these narrowly scoped existing active-obligation actions; banned work exceptions remain D5 and fail closed. No date automation.
- Ordinary Job cancellation (including from CLOSED) blocks active ACCEPTED/IN_PROGRESS Engagements. Explicit completion requires CLOSED, at least one COMPLETED Engagement and no active Engagement. Both cancel outstanding non-engaged pipeline and revoke pending Offers in the Job transaction. Accepted/historical terminal records remain.
- All fields except description wording retain Phase 4's conservative material classification, including headcount increase/decrease after the first Application. Independently never allow headcount below actual occupied slots. Close/duplicate for new recruiting terms.

## 3. Database models / migrations

Additive `20261008000100_hiring`: three enums and three tables, with UUID identities, timestamps/indexes, RESTRICT history FKs and composite consistency. Application lifetime UNIQUE(jobId,workerProfileId); Offer UNIQUE(applicationId,creationKey/revision), partial one-PENDING index; Engagement UNIQUE applicationId and acceptedOfferId. Composite keys bind the same Job/Application/Worker/Offer. CHECKs validate revision/expiry/resolution, snapshot version and work metadata. SQL triggers freeze Offer terms/identity/time and terminal resolution; Engagement insert requires accepted evidence and an identical Offer snapshot, update freezes accepted identity/terms/time and terminal history. Previous migrations are intact; no db push/reset/SQLite.

## 4. Application lifecycle

APPLIED→explicit VIEWED→SHORTLISTED→OFFERED→ACCEPTED. Direct APPLIED→SHORTLISTED is allowed. Pre-acceptance reject/withdraw/cancel are terminal; no work states belong to Application. An existing Engagement blocks withdrawal/rejection. Same-action retries are safe where applicable; no generic status patch or history delete endpoint exists.

## 5. Application eligibility / self-apply / uniqueness

Fresh ACTIVE WORKER, verified email and WorkerProfile; nonempty name/headline, city or Remote, work preference/mode, at least one active Skill, availability for PART_TIME/TEMPORARY/SHIFT. Required Skill must be present at BEGINNER<INTERMEDIATE<ADVANCED<EXPERT level or above. Optional skills do not block. Personal owner/current Company OWNER or MANAGER cannot self-apply; departed creator provenance is irrelevant. Unrelated dual-role accounts may apply. No location/schedule-overlap/pay matching gate or Match Score. Lifetime uniqueness survives withdrawal/rejection/cancellation; same creation-key retry returns the existing own Application.

## 6. Offer lifecycle / immutable revisions

Only verified ACTIVE current Job managers can create an Offer from SHORTLISTED with no Engagement or pending Offer and Job PUBLISHED/PAUSED. Atomic creation moves Application to OFFERED. PENDING→ACCEPTED/DECLINED/REVOKED/EXPIRED; terminal Offer history cannot mutate. Each new proposal creates the next immutable revision with a creation-key replay check; optional compensation range is explicit exact VND strings, remaining structured terms snapshot the current Job. Expiry is optional, later than creation, and server/database evaluated. One pending Offer is SQL enforced.

## 7. Offer acceptance transaction

Canonical order: current actor User→Company/personal EmployerProfile→Job→Application→Offer→Engagement. Worker actions take the same owner lock as Job writes/membership removal, without locking a second User. Acceptance after these locks rechecks fresh role/status/email/profile/skills/self-membership, PENDING/unexpired Offer, OFFERED/no Engagement Application and Job PUBLISHED/PAUSED/CLOSED. Count occupied Engagement rows; require count<headcount. Update Offer ACCEPTED, Application ACCEPTED and create exactly one immutable Engagement in one PostgreSQL transaction. Same accepted-Offer retry returns the same relationship; it never allocates another slot.

Expiry uses `clock_timestamp() AT TIME ZONE 'UTC'`, tested against a non-UTC PostgreSQL session. Expired acceptance commits normalization and then returns conflict, avoiding rollback of EXPIRED. Detail touch persists expiry; lists safely project overdue latest Offer/Application state without mutating VIEWED or relying on cron. Wrong ownership/identity fails before any private expiry write.

## 8. Engagement lifecycle

Acceptance is the only creation service. ACCEPTED→Employer IN_PROGRESS→Worker completionRequestedAt→Employer COMPLETED. Employer cannot skip the Worker request. Either current party can cancel ACCEPTED/IN_PROGRESS; CANCELLED remains historical and frees capacity. Repeated completion request preserves its first timestamp. No automatic state change on start/end date; no manual standalone create, admin override or generic status patch.

## 9. Capacity / concurrency

Actual ACCEPTED/IN_PROGRESS/COMPLETED Engagement rows occupy one slot; CANCELLED does not. All capacity changes serialize on Job; no cached count or process lock. PostgreSQL tests use independent connections, hold a real lock and observe contenders waiting before releasing it. Headcount 1/two valid Offers gives exactly one winner/one conflict and one Engagement. Tests also verify expiry while acceptance waits, fresh User suspension while waiting, Company membership removal while Offer creation waits, cancellation reopening capacity and completed work retaining capacity.

## 10. Job lifecycle interaction

CLOSED preserves pending acceptance but blocks new recruitment and reopen. CANCELLED/COMPLETED block new acceptance; accepted retry is retrieval of its existing relationship. Active work blocks unsafe cancellation. Job completion requires CLOSED and completed work/no active obligations. Outstanding non-engaged Applications→CANCELLED, pending Offers→REVOKED in the same transaction; accepted/withdrawn/rejected/cancelled history persists. PUBLISHED+PAUSED quota remains three independently per personal profile/Company.

## 11. Material-edit guard activation

Under the existing owner+Job locks, Jobs calls hiring's public `hiringEditContext` query to load actual Application existence and occupied Engagement counts. It passes HIRING context into the existing policy. No fake table/count/cache. Tests cover editable terms before any Application, denied compensation/location/type/dates/schedule/title/category/skills/headcount after one, actual lower-than-occupied denial and allowed description wording.

## 12. Immutable snapshots

Offer snapshot v1: Job ID/version, schema version, full explicit Job terms (whole-VND strings, units/currency, dates, timezone/schedule, skills/headcount context), owner identity and historical display/badge, created/expires timestamps. Engagement copies that accepted Offer snapshot plus Worker display/headline and accepted time. SQL triggers enforce immutability; tests reject direct term writes and verify display remains unchanged after Company/User rename. DTOs reconstruct allowlisted snapshot fields and strip internal owner IDs/actor provenance; raw JSON is never publicly returned.

## 13. Worker routes/UI

`/worker/applications`, `/worker/applications/[applicationId]`; eligible signed-in Worker Apply on public Job detail, previous-Application link otherwise. Own bounded list/detail, offer history, withdraw/accept/decline, completion request and explicit reasoned cancellation. Forms use stable per-request creation keys, disabled busy controls, labels and live feedback; server authorization remains decisive.

## 14. Employer routes/UI

`/employer/jobs/[jobId]/applications`, `/employer/applications/[applicationId]`, linked from management. Current Job managers see bounded safe candidate projections, completeness/skills, explicit viewed/shortlist/reject, new Offer/revisions and revoke. Work controls start/confirm completion/cancel; Job management adds guarded CLOSED completion/cancellation. Offer history is separately paginated; no arbitrary status selector, messaging or contacts.

## 15. Authorization / privacy / security

Real Better Auth sessions and current roles/status plus relational scope on every request. Exact-origin writes, 16 KiB JSON boundary, strict allowlisted Zod bodies/queries, UUID cursors/default12/max30, no-store and existing no-referrer headers. Identity/status/ownership injection and IDOR tests fail safely. Employer hiring projection reuses safe discovery fields plus completeness; Application context grants access independently of discovery opt-in. No email/phone/auth ID/session/moderation/raw private availability; cancellation actor and internal snapshot owner ID are omitted. Actor text/reasons/payloads are never logged. Services, factories and DB stay server-only; client imports are type-only DTOs and UI helpers. No admin bypass.

## 16. Tests

Local Node 24.20.0, pnpm 11.25.0 and disposable PostgreSQL 18.6. Evidence is from executed commands, not authored tests alone:

| Check | Result / evidence |
|---|---|
| install | PASS — pnpm install --frozen-lockfile; lockfile unchanged |
| Prisma validate | PASS — pnpm db:validate |
| lint | PASS — pnpm lint |
| typecheck | PASS — pnpm typecheck, Prisma generation and Next route types |
| unit | PASS — 261 tests / 12 files, including 64 hiring tests and updated Job action matrix |
| build | PASS — pnpm build, dynamic Node hiring pages, no runtime credentials required |
| migration deploy/status | PASS — all six migrations applied fresh; up to date; repeat deploy no-op verified |
| db smoke | PASS — generated-client CRUD rolls back transient User |
| Phase 2 regression | PASS — real PostgreSQL auth/verification/reset/session/roles/status |
| Phase 3 regression | PASS — profiles/company/discovery/privacy and observed lock races |
| Phase 4 regression | PASS — Jobs/quota/lifecycle/constraints/revocation/status races |
| Phase 5 PostgreSQL integration | PASS — pnpm test:hiring, actual constraints/eligibility/revisions/acceptance/work/cleanup/IDOR/snapshots |
| HTTP tests | PASS — actual Next Phase 2–5, multi-user authenticated hiring/UI pages; only mail transport intercepted |
| concurrency tests | PASS — last slot, expiry while waiting, fresh suspension and membership removal; earlier phase races retained |
| GitHub Actions | BLOCKED pending publication/remote execution; replace only with observed exact-commit evidence |

PASS — final migration SQL, DTO privacy/lock-order, React client/server boundaries, dependency/historical-file preservation, ignored secret paths, secret-pattern scan and staged diff review. Local PostgreSQL suites emit the existing pg 8.23.1 deprecated concurrent-client-query warning also seen in earlier phases; assertions pass. No pg upgrade is introduced. Provider TLS/pooling/proxy behavior and browser-interaction E2E are not claimed tested by these local/HTTP checks.

## 17. Deployment compatibility

Compatible with managed Next.js Node runtime, injected origin/secrets, managed PostgreSQL and existing email provider. Production state/locks are database backed; no developer-PC dependency, local filesystem, local worker, in-memory production lock, hardcoded production localhost, Redis or cron dependency. Production provider/region/TLS/proxy setup remains a separately provisioned/reviewed environment. No deployment performed.

## 18. Files changed

- New hiring module: contracts, pure policies/tests, DTO projection, public Job query/orchestration boundary, services, server pages and interactive action forms.
- Four hiring route wrappers; marketplace API allowlist/action adapters; Job pages/actions/service/policy integration; profile safe selector/navigation.
- Prisma schema plus one additive hiring migration; dedicated hiring PostgreSQL suite, extended actual HTTP harness; package test script and PostgreSQL CI step. No dependency/lockfile changes.
- AGENTS, ARCHITECTURE, DATABASE, SECURITY, ROADMAP, README, module boundary note and this report. PRODUCT, Phase 0–4 reports and earlier migrations unchanged. Generated clients/builds/env/temporary DB/fixtures excluded.

## 19. Deviations / unresolved decisions

The module is named `hiring` to own Application/Offer/Engagement orchestration together while keeping tables separate. Ordinary cancellation uses the requested minimal party-initiated rule; rejected pending Offer requires explicit revoke. PAUSED permits only existing pipeline hiring. Whole Job snapshots preserve Phase 4 terms; an Offer may separately propose a compensation range. Material terms/headcount freeze remains conservative. No disputes/admin force actions, matching, contact release, invitations, notifications/outbox, reviews, uploads or full D5/D7 decisions are introduced.

## 20. Remaining blockers

No known local implementation blocker after passing checks. Remote publication/CI remains pending until recorded in section 21. Deployment/provider operations and Phase 6 are outside authorization, not silently treated as completed. The pg deprecation warning is recorded above for later driver compatibility work.

## 21. Git commit / remote CI evidence

Pending reviewed commit/push to current `main`. Standing user publication authorization applies; no force push/history rewrite. Record the exact remote SHA and both `checks`/`postgres-auth` job outcomes after observing them; do not mark Phase 5 delivery complete before that verification.
