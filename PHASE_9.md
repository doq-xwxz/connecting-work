# Phase 9 — Reports + Moderation + Admin

User authorized Phase 9 after approving Phases 0–8, plus automatic commit/push to main and exact remote/CI verification. PRODUCT, PHASE_0, approved historical reports and migrations remain unchanged. Stop after Phase 9; no Phase 10 or deployment.

## 1. Phase 9 Summary

Private report intake and status receipts, bounded ADMIN report/case triage, explicit case-bound resource actions and immutable transactional audit are implemented. Existing ownership, immutable hiring history, contextual chat and deterministic matching stay authoritative.

## 2. D5 decisions resolved

SUSPENDED denies new recruiting/reviews but retains established scoped active work obligations and dispute reporting. BANNED denies normal marketplace reads/writes; approved own discovery opt-out and scoped Job exposure reduction remain, with auth/account separate and records intact. No unban, automatic punishment, appeal engine or promised SLA. Hidden Job blocks new apply/offer/accept/publish/resume and public/candidate recruiting; unhide restores only the visibility overlay. Visible CLOSED pending acceptance remains valid. Suspension alone does not hide ads. A personal banned owner is excluded; a Company needs at least one current non-banned EMPLOYER OWNER/MANAGER, independently of creator provenance. Company has no new ban state. Reviewer ban never implicitly hides old reviews. FORCE_COMPLETE permits subsequent voluntary bilateral reviews and counts as completed work; FORCE_CANCEL has no Worker cancellation attribution. No new analytics semantics.

## 3. Report model / workflow

Report targets JOB/REVIEW/USER/MESSAGE/COMPANY and scoped ENGAGEMENT disputes. Strict reason enum; optional plain details ≤2000, required for OTHER. Fresh normal role and actual visibility/relationship required before deduplication. OPEN → IN_REVIEW on exact case attachment → RESOLVED/DISMISSED on case close. Partial uniqueness permits one unresolved report per reporter/type/ID. Retrying is free; new reports use a PostgreSQL 10/hour per-actor budget. No threshold sanctions or report email.

## 4. Moderation Case model / workflow

An existing exact target, trusted opening admin, fixed severity LOW/MEDIUM/HIGH/CRITICAL and timestamps define the case. OPEN → INVESTIGATING → ACTIONED → CLOSED; direct legal skips are explicit, terminal cases cannot reopen or mutate resources. Reports can attach only while OPEN, to the same target, and once per report. Closing atomically records reason/resolution and resolves/dismisses linked reports. Case may be opened directly or from a Report.

## 5. Admin authorization

Real session + fresh ACTIVE ADMIN is checked inside every service transaction, independently of Company membership. SQL audit INSERT also checks role/status. Revoked role or suspended/banned admin immediately loses access on fresh requests. No signup grant, role-management endpoint, cookie-role trust or normal-role bypass. Existing operational provisioning procedure remains in SECURITY.

## 6. Audit trail

AuditEvent records action enum, admin FK, case FK, exact resource, bounded reason code/text, timestamp, bounded server metadata and current PostgreSQL transaction ID. INSERT-only guard rejects UPDATE/DELETE. Resource action audit and write are atomic; same-transaction binding guards plus deferred effect validation reject missing/orphan actions. Latest resource audit pointers preserve provenance without circular FKs. Privileged DB operators can disable triggers, so managed least privilege/backup/retention remain operational duties. Application has no audit deletion API. CASE_CONTEXT_READ audits exceptional single-resource investigation.

## 7. User suspension / ban semantics

ACTIVE→SUSPENDED, SUSPENDED→ACTIVE, ACTIVE/SUSPENDED→BANNED are explicit case commands with reason. Ban is terminal in this API. Existing own privacy opt-out and scoped Job exposure reduction remain approved exceptions; no general marketplace or Engagement bypass. Status and current role rechecks use the same User NO KEY UPDATE lock as normal business writers. Existing Applications/Offers/Engagements/Reviews/Messages survive. Suspended active parties may start/request/confirm/cancel/chat/report that active Engagement, under current ownership/role/state; no review or new recruiting. Banned obligation exceptions remain fail closed.

## 8. Job moderation

Nullable moderationHiddenAt overlays lifecycle; hide/unhide increments optimistic version and records bound audit. No cancellation/completion or rewrite of hiring history. Public detail/FTS/recommendations and new apply/offer/accept/publish/resume reject hidden Jobs. Current entitled history and active work remain accessible. Unhide never changes status or reopens CLOSED. Company ownership derives from current membership, not creator.

## 9. Review moderation

Phase 8's INSERT guard remains. Evolved UPDATE trigger freezes every field except hiddenAt/moderationAuditId, permits only audited visibility flips, and retains author/target/content/terms history. Hidden reviews are omitted from ordinary views, public aggregates and matching. Unhide restores the original fact. No edit/delete/reply API or automatic hiding on author ban.

## 10. FORCE_COMPLETE / FORCE_CANCEL

FORCE_COMPLETE requires IN_PROGRESS, sets COMPLETED/completedAt and preserves startedAt/request field, including a null Worker request. FORCE_CANCEL requires ACCEPTED/IN_PROGRESS, sets CANCELLED/cancelledAt without fabricated participant reason/cancelledBy. Both preserve accepted Offer/Engagement terms, lock the same Job for capacity, and require exact case/reason/actor/audit. Terminal retries/conflicting actions fail. Completed occupies capacity; cancelled frees it. Neither automatically finalizes Job or sends messages/reviews. Existing chat becomes read-only after terminal work.

## 11. Case-target binding

Both type and ID must match before and after resource locking; same UUID with different type is insufficient. Resource-state checks run under lock; closed cases cannot act. CaseReport SQL guard enforces identical target and unresolved workflow. Case-specific audit cursors reject another case's event. No arbitrary SQL, status patch, unrelated resource action or unrestricted conversation reader exists.

## 12. Search / matching / reputation integration

Shared safe Job visibility predicate covers ORM and parameterized FTS plus hydration; SQL partial GIN now excludes hidden Jobs without dropping the generated search vector. Owner ban visibility derives from current ownership. Review facts are queried on demand in batch: hidden rating drops coverage/rating inputs and unhide restores them; concurrent readers observe committed before/after facts with no stale cache. Matching remains weights v1/algorithm deterministic-v2. Historical v1/null Application snapshots remain immutable. Measured candidate query count is 26 for one and 203 eligible candidates (200 evaluated); reputation facts remain 2 including transaction overhead for one/200.

## 13. Privacy / security

Strict schemas, exact origin, allowlisted actions/query keys, 16 KiB body, max50/default20 pages and safe errors. Plain text is escaped, never rendered as HTML. Own receipts omit reporter/admin notes/private USER target ID. Case reporter identity/details are ADMIN-only. Application-context reporting derives User/Company server-side rather than putting private account IDs in forms. Message report requires current conversation entitlement; investigation returns only the bound Message with reason+audit, no history/auth/email. Private routes use no-store/no-referrer. Structured logs carry static action/opaque IDs/outcome/duration, never report details/reasons/messages. No uploads or evidence attachments.

## 14. Admin routes/UI

Dynamic `/admin/cases`, `/admin/reports`, `/admin/cases/:id`; `/admin` redirects to guarded cases. Reports UI `/reports/new` and `/account/reports`. Job/Review/Message/Engagement/contextual counterparty links lead to scoped forms. ADMIN lists filter status/type/severity, paginate and create cases; detail shows bounded linked reports/audit and state-specific explicit actions. Exceptional context viewing is POST with reason. API `/api/admin/cases`/`reports`, case detail/audit/reports and explicit investigate/close/context/actions; normal reports use `/api/marketplace/reports` and contextual `/(worker|employer)-applications/:id/report-counterparty`. No broad User search/export or arbitrary history panel.

## 15. Database migration / indexes

Additive `20261009090000_moderation`; ten migrations total. New Report/Case/CaseReport/Audit enums/tables and nullable overlays/pointers, RESTRICT historical FKs, generic target existence/immutability/delete guards, partial unresolved uniqueness, bounded checks and indexed administrative lists. SQL owns visible Job/FTS indexes, Review update evolution and audited Engagement lifecycle extension. Old SQL stays unchanged. Fresh deploy/status/smoke and populated rollback-only Phase 8→9 rehearsal preserve visible/hidden reviews, terms and v1/null snapshots. Repeat deployment is a no-op.

## 16. Concurrency / lock order

User NO KEY UPDATE → Company/personal EmployerProfile → Job → Application → Offer → Engagement → Review → Case → Report/Audit, taking only needed rows. Account action sorts actor/target User IDs, then personal profile/current Companies. Message/report context keeps the established Worker-contact advisory lock before owner/Job. Preliminary case reads grant no authority; binding is rechecked after resource locks. No Case→resource inversion. Membership removal uses the same Company lock. Tests observe actual PostgreSQL Lock waits before committing audited suspension/hide; capacity race accepts at most the freed slot. Review aggregate race allows committed before/after and confirms current exclusion.

## 17. Tests

Local verification uses Node 24.20, pnpm 11.25 and a random-credential loopback-only disposable PostgreSQL 18.6. No production DB/provider email used. Status at implementation review:

| Check | Result |
|---|---|
| Frozen install | PASS |
| Prisma validate | PASS |
| Lint / typecheck | PASS |
| Unit | PASS — 373 tests / 16 files |
| Production build | PASS |
| Migration deploy/status / repeat deploy | PASS — ten migrations, no pending SQL |
| DB smoke | PASS — transient CRUD rolled back |
| Phase 2 auth regression | PASS |
| Phase 3 profiles/company regression | PASS |
| Phase 4 Jobs regression | PASS |
| Phase 5 hiring regression | PASS |
| Phase 6 matching/FTS regression | PASS |
| Phase 7 messaging regression | PASS |
| Phase 8 reviews regression | PASS |
| Phase 9 PostgreSQL / populated upgrade | PASS |
| Actual Next HTTP Phase 2–9 | PASS |
| Observed concurrency / capacity / visibility | PASS |
| GitHub Actions | Verified after publication; exact run/SHA in final delivery |

Tests exercise duplicate reports/privacy/rate budget/target IDOR, fresh admin/current membership, action rollback, immutable audit update/delete rejection, closed/wrong cases, review content/history guard, hide/FTS/acceptance, reputation/coverage/frozen snapshots, forced lifecycle/terminal chat, Company creator independence and banned owner visibility. HTTP uses real sessions/roles/PostgreSQL and intercepts only email transport in its child. Test-only cleanup removes owned fixture audit before target history, never imports into app. The existing pg parallel-query deprecation warning appears in regression internals; pinned pg 8 behavior passes, no runtime dependency changed.

## 18. Deployment compatibility

All runtime state remains in managed PostgreSQL and injected env with Node/Next. No developer-PC service, filesystem credential, local cluster, daemon, cron or in-memory production state is required. Disposable binaries/env are ignored test tooling only. No deployment was performed. Provider TLS/pooling/proxy/backup/least privilege and D4/D7/D8 production readiness still require environment-specific verification when authorized.

## 19. Files changed

New moderation contracts/service/target authorization/UI/tests, domain moderation boundaries, additive Prisma migration/models, thin ADMIN/report pages/API, report links, visibility gates in jobs/hiring/matching/reviews, ban guard, opaque case logging, private headers, PostgreSQL moderation/upgrade/cleanup scripts, expanded actual HTTP harness, test command/CI and current governance/docs. No dependency or lockfile change; no PRODUCT/PHASE_0/approved PHASE_1–8/historical migration edits. Full manifest is the commit diff.

## 20. Deviations / unresolved decisions

ENGAGEMENT is an additional narrowly scoped report target to fulfill PRODUCT's suspended active-work dispute path. Case binding uses one direct target; Company→Job/User enforcement requires a separately bound case, preventing cross-target powers. Generic polymorphic target checks are explicit SQL/service controls, not false FK claims; trusted physical deletions require a future D7 protocol. Audit pointers are validated scalar latest-action references. Appeal process, dedicated ADMIN throttle, formal SLA, retention/anonymization, verification badges/document processing, evidence uploads, asynchronous email/outbox, AI/analytics and unban are deferred. No unsupported legal deadline or automated punishment was invented.

## 21. Remaining blockers

No local implementation/validation blocker remains. Production readiness/deployment is outside authorization. Publication/remote CI outcomes must be confirmed against the exact pushed SHA; do not substitute local success or an older run. Stop after Phase 9.

## 22. Git commit / remote CI evidence

Publication is explicitly authorized to `https://github.com/doq-xwxz/connecting-work` on current `main`, after staged diff/secret/artifact review. No force push/history rewrite. Final delivery records the actual commit URL, exact `refs/heads/main` match and relevant GitHub Actions job conclusions. This source report does not guess its own future commit SHA or mark remote checks passed before they run.
