# Phase 4 review — Jobs + Publishing + Ownership + Quota

Evidence date: 2026-10-07. PRODUCT and approved Phase 0–3 reports remain intact. Phase 4 only; no deployment or Phase 5. Authored behavior and executed evidence are separated below.

## 1. Phase 4 Summary

Implemented personal and Company Jobs, drafts/editing, explicit publish/pause/resume/close/cancel, safe duplication, structured recruiting terms, public PUBLISHED ads, employer management and atomic owner-scoped quota. COMPLETED is represented but has no ordinary action. No Application, Offer, Engagement, matching, messages, audit subsystem or uploads were added.

## 2. Phase 4 decisions resolved

Required pre-hiring D2 subset: CLOSED never reopens; CLOSED/CANCELLED/COMPLETED are terminal; close means normal recruitment end, cancel means withdrawn opportunity. Dependent hiring cleanup and completion remain Phase 5/D2. Required D3 subset: anonymous active marketplace shows PUBLISHED only, with coarse city and safe owner display; no exact address/GPS/contact schema. Full owner-status moderation/hiding remains D5. Public employer-written text is escaped but not automatically redacted.

ACTIVE unverified employers may prepare/edit/duplicate drafts, following PRODUCT and request §24; verified email gates publishing/resuming and active-term edits. This interprets the earlier request §4 together with its later explicit draft exception. SUSPENDED/BANNED deny new activity but can pause/close/cancel owned records after role/membership/state checks. No future hiring obligations are assumed.

Reuse seven EmploymentType values, three WorkMode values, existing SkillLevel/taxonomy; five Job categories mirror initial taxonomy categories. VND-only integer ranges, four PRODUCT units, headcount 1–1000, optional DATE period and normalized whole-hour local weekly windows are sufficient now. PART_TIME/TEMPORARY/SHIFT require a window to publish. Opaque UUID routes avoid mutable-title slugs. These are implementation bounds, not matching or payroll policy.

## 3. Database models / migrations

Additive `20261007040000_jobs` adds Job, JobSkill, JobScheduleWindow and three enums. Historical migrations are unchanged. Job references creator User, EmployerProfile and optional Company with RESTRICT. Child relations are explicitly replaced transactionally, never public-deleted. Compound JobSkill PK, actor/key retry uniqueness, schedule uniqueness, owner/status/filter/skill indexes, CHECKs for positive bounded headcount/version, exact compensation, DATE ordering/range and lifecycle timestamps are included. Prisma client remains generated/ignored. Fresh migration, repeat no-op and status evidence are recorded in §15.

## 4. Job ownership model

Personal: companyId null, current actor's EmployerProfile is owner. Company: companyId selects stable owner; creator and originating profile are provenance. Current OWNER/MANAGER authorizes each read/write; no ADMIN bypass. Creator departure removes management and duplication authority without transferring/deleting Jobs. Company quota includes all creators. Ownership cannot be changed through edit payloads. Controlled test-only SQL ownership replacement is not a public transfer flow.

## 5. Job lifecycle / state machine

Eight transitions: DRAFT→PUBLISHED; PUBLISHED→PAUSED; PAUSED→PUBLISHED; PUBLISHED/PAUSED→CLOSED; DRAFT/PUBLISHED/PAUSED→CANCELLED. Explicit services check state and optimistic expectedVersion. Terminal states cannot edit/reopen. COMPLETED is schema/policy only, intentionally inaccessible until hiring context. No automatic completion by end date. Duplication creates fresh DRAFT, new ID/current actor provenance, safe terms/skills/windows, version one and null historical lifecycle timestamps. Actor-bound creation keys handle retries and cannot return the source as its own duplicate.

## 6. Compensation / schedule / headcount

PostgreSQL BigInt amounts serialize as canonical integer decimal strings. Whole VND, 0–1,000,000,000,000, min<=max; equal bounds express fixed compensation. No JS/DB floating-point money. HOURLY/DAILY/PROJECT/MONTHLY describe ad units, not payments. Drafts may omit both bounds; publish requires type and both. Requested headcount is 1–1000; no browser occupied count or fake capacity column.

Schedule: recurring weekday 0–6/start 0–23/end 1–24, start<end, IANA timezone, max 14 nonoverlapping windows; adjacent allowed, overnight split. Start/end are optional PostgreSQL DATE and API YYYY-MM-DD, bounded 2000–2100, end requires start/end>=start. UTC-midnight conversion avoids browser timezone drift. Lifecycle timestamps are UTC instants.

## 7. Job skills

Existing controlled active Skill IDs, required boolean, minimumLevel in the existing four levels. Unique Job+Skill, max 20, duplicates/unknown/inactive additions rejected. At least one active skill is required to publish/resume. Optional skills remain data only; no eligibility calculation or Match Score exists.

## 8. Publish validation

Server-derived publishValidation returns valid/missingFields for title, description, category, employment type, work mode, relevant city, compensation, headcount, active skill set and applicable weekly schedule. Boundary validation additionally checks dates, money, array/time limits and strict fields. Publication rechecks current verified ACTIVE actor, role/profile, ownership/membership, state/version and quota under locks. UI required/disabled controls are informational only.

## 9. Active-job quota

Three PUBLISHED+PAUSED per personal EmployerProfile; separately three per Company, never creator-scoped. Unlimited by quota DRAFT creation (individual requests remain bounded); closing/cancelling frees a slot; pausing does not. Resume rechecks quota but does not double-count its PAUSED row.

Mutation protocol: lock/re-read User → personal EmployerProfile or Company → existing Job; membership revocation locks that same Company. Count and transition occur in one PostgreSQL transaction under the owner lock. Independent-connection tests race different Company actors and personal publication, and race resume against publication. No browser counts, in-memory mutex, quota counter or cross-row CHECK pretence.

## 10. Material-edit policy preparation

Explicit JobTerms schemaVersion 1 serializes exact money, dates, controlled skills and schedule without relying on mutable display text. Copies omit ownership/history. Description wording is conservatively non-material; other structured recruiting fields are material, array reordering is ignored. PRE_HIRING is structural because hiring tables do not exist. The HIRING guard has real-facts inputs hasApplications/occupiedSlots; it blocks material edits after applications and headcount below occupancy. Unit tests exercise this direction only. Phase 5 MUST load those real facts under Job lock and activate the guard. No fake application count or prematurely stored snapshots. Exact headcount-change exceptions and dependent hiring cancellation/completion remain D2.

## 11. Public Job projection / privacy

Explicit DTO: Job opaque ID, recruiting terms/skills/local ad schedule, publishedAt, personal display name or Company name/slug/verification badge. No creator/user/profile/Company internal ID, email, phone, membership, account status, internal metadata or auth data. Only PUBLISHED is readable publicly; all other states return safe 404. Text is React-escaped. Public lifecycle queries use no-store. A suspension does not silently rewrite/hide published ads; D5 moderation policy remains deferred, while authorized restrictive actions are available.

## 12. Employer management routes/UI

`/employer/jobs`, `/new`, `/[jobId]`, `/[jobId]/edit`: current manageable Jobs, owner type, status, personal/Company quota, completeness, structured form, explicit actions and duplicate. Company chooser pages through current memberships. Strict same-origin API: GET/POST `/api/marketplace/employer-jobs`, GET/PUT `/:id`, POST `/:id/publish|pause|resume|close|cancel|duplicate`. Current role/profile required; private management DTO has version/timestamps/quota, not raw models. No generic status patch/delete/completion/ownership move.

## 13. Public routes/UI

Anonymous `/jobs`, `/jobs/[jobId]`; GET `/api/marketplace/jobs` and `/:id`. Basic PostgreSQL city/employmentType/workMode/category/skillId filters; immutable UUID ascending cursor, default 12/max 30, take+1. Unknown/duplicate query keys and malformed cursors fail. UI filters cover city/type/mode/category. No FTS, score, recommendations or application action; detail explicitly says hiring is unavailable.

## 14. Authorization / security

Real sessions plus fresh role/status/email/profile/ownership checks; server-only service boundaries. Locks serialize sensitive mutation versus revocation/suspension. Stale versions conflict. Unknown/protected fields and unsafe money/dates/schedules rejected with static safe errors. 16 KiB JSON, exact configured Origin, no wildcard CORS. Logs never contain ad payloads or sensitive diagnostics. ADMIN alone cannot manage/discover. No production auth/email persistence fallback or HTTP-test preload import was added. Future trusted writers must preserve the same locks/invariants.

## 15. Tests

Executed local checks: install frozen PASS; Prisma validate PASS; lint PASS; typecheck PASS; unit PASS (191 tests, 11 files); build PASS. No dependency or lockfile change.

Executed against a fresh disposable PostgreSQL 18.6 cluster: migration deploy PASS (all five migrations from zero); repeat deploy PASS (no pending migrations); migration status PASS; DB smoke PASS (transient User rolled back); Phase 2 auth regression PASS; Phase 3 profile/company regression PASS; Phase 4 PostgreSQL integration PASS; actual Next HTTP Phase 2–4 regression PASS. Test server and database were stopped after execution. Credentials/cluster/binaries were confined to ignored temporary verification files; no production endpoint was used. GitHub Actions result is recorded in §20 after publication.

Unit coverage includes all six states × five actions, exact money/date/headcount/skill/schedule validation, publish completeness, ownership/quota, serializable terms, future guard and DTO privacy. Dedicated jobs script covers DB constraints, independent quotas, competing publishers/resume, actor/membership lock waits and departed creators. HTTP suite retains all Phase 2/3 checks and adds anonymous/public/private Job routes, unverified/suspended policy, origin/mass assignment, quota and explicit actions. Only email transport is intercepted in the development child; real Next/Better Auth/PostgreSQL remain in use.

## 16. Deployment compatibility

Production remains independent of the developer PC: all persistent business/session/quota data in PostgreSQL; production origins/secrets from env; Node-managed Next hosting compatible; no local filesystem state, in-memory security lock, local scheduler or background developer process. Local disposable PostgreSQL is verification infrastructure only. No deployment performed. Provider TLS/pooling/proxy/region, sender, release hardening and operational readiness still require the separately authorized environment.

## 17. Files changed

Governance/docs: AGENTS, ARCHITECTURE, DATABASE, SECURITY, ROADMAP, README, PHASE_4. DB: schema and additive jobs migration. Jobs module: contracts, pure policies/tests, projection, server-only services/pages, client form/actions. Presentation: public/management route wrappers, navigation/account/home links, marketplace adapter. Integration: jobs-integration, auth-http extension, package script, CI step. Auth change is fresh emailVerified selection in the existing transaction helper. Profile change extends only safe field-error keys/navigation. No dependency or lockfile change; generated/local outputs excluded.

## 18. Deviations / unresolved decisions

Separate employer-jobs management namespace makes public projection explicit; opaque Job IDs instead of slugs. Draft verification exception and restrictive suspended actions are documented above. Currency, bounds, schedule-required types and coarse locations are the required foundation choices. No exact address, deadline/urgency field, payroll, application count or speculative occupied-capacity implementation. Public text is not a contact-redaction system. Full hiring effects/material-edit facts/completion (D2), exact disclosure (D3), full BANNED/moderation (D5), matching and other deferred decisions remain intact. Browser automation is not claimed by the HTTP server-rendering checks.

## 19. Remaining blockers

Local Phase 4 validation has no remaining blocker. Remote CI is pending publication at report drafting; §20 records the final evidence. Phase 5 and deployment are intentionally outside authorization, not missing Phase 4 features. Historical PRODUCT/Phase 0–3 decisions and original migrations remain unchanged. PostgreSQL Phase 3/4 suites emitted a pg deprecation warning about overlapping queries on one connection; both passed on supported pg 8.23.1. Jobs quota-read queries on its single transaction connection are sequential; the integration races deliberately use independent transactions. The warning's exact adapter/library origin has not been attributed; reassess before a pg 9 upgrade. It is not a current validation failure.

## 20. Git commit / remote CI evidence

Publication pending validation and staged-diff/secret review. Current branch main, origin https://github.com/doq-xwxz/connecting-work.git. No force push or history rewrite. Final commit SHA, exact remote match and both CI job results will be recorded after push.
