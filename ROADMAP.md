# Implementation roadmap

[PRODUCT](PRODUCT.md) is source of truth; [PHASE_0 §13](PHASE_0.md#13-implementation-roadmap) holds objectives, PR slices, tests and Definition of Done. This file tracks execution without silently approving deferred D1–D9.

| Phase | Objective / dependency | Deliverables / test gate | Status |
|---|---|---|---|
| 0 | Planning and review | Approved product/architecture and deferred register | Complete |
| 1 | Foundation, user authorized | App/tooling, governance, env/DB client, minimal probe migration/smoke, safe errors/logs, unit/CI, honest shell. Install/lint/typecheck/tests/build; DB separately verified or explicitly blocked | Approved; historical evidence in PHASE_1.md |
| 2 | Auth/authorization, user authorized after 1 review | Better Auth email/password/verify/reset, dual roles, trusted admin provisioning procedure, scoped status guards; unit/security checks, authored PostgreSQL suite | Approved and closed; real PostgreSQL/auth/HTTP + CI PASS, see PHASE_2.md |
| 3 | Profiles/company after 2; D1 data/D3 | Profiles/skills/hourly availability/completeness, private opt-in discovery, Company OWNER/MANAGER; real PostgreSQL/HTTP + revocation/suspension races | Approved; historical evidence PHASE_3.md |
| 4 | Jobs after 3; limited D2/D3 | Personal/Company drafts, structured terms, explicit lifecycle, duplicate, public projection and atomic owner quota; PostgreSQL/HTTP races/security | Approved; historical evidence in PHASE_4.md |
| 5 | Hiring after 4; limited D2 | Application/immutable offer revisions/atomic accept/Engagement lifecycle; capacity, uniqueness, snapshots and real HTTP | Authorized and implemented; validation/review evidence in PHASE_5.md. Stop here |
| 6 | Search/matching after data/hiring; D1/D3 | PG FTS/filters/score+coverage/opt-in discovery; normalization/privacy/performance tests | Planned |
| 7 | Communication after hiring; D6/D8 | Accepted invitation, block exceptions, polling, inbox/email/outbox retries; access/dedupe tests | Planned |
| 8 | Reviews after engagement; D1 | Per-completed-Engagement/direction/subject immutable reviews, sample-count rebuild; eligibility tests | Planned |
| 9 | Trust/admin after owning modules; D5 | Risk/reports/badges/moderation/operational admin, case-bound FORCE audit; escalation tests | Planned |
| 10 | Hardening after 1–9 | Full threat/auth matrix, privacy/cache/media/rate/concurrency/secret checks; resolve critical/high issues | Planned |
| 11 | Metrics after lifecycle facts; D9 | Completed Engagements, relevance eligibility+score70+coverage60, versioned 3/24h liquidity, PII-safe monitoring; denominator/history tests | Planned |
| 12 | Production readiness; D4/D7/D8/D9 | Legal/phone policy, backups/restore/rollback/migration rehearsal/provider outage/E2E/accessibility/ops signoff | Planned; deployment separately authorized |

Each phase splits into reviewable PR-sized changes per PHASE_0, not one all-feature scaffold. Security/verified-email gates/audit timestamps belong to the phase introducing that activity; later hardening is verification, not first protection. No full outbox until Phase 7, enterprise capability engine, document management, malware pipeline, WebSocket, Redis, microservice or external search during Foundation. Legal retention durations/phone provider are not Foundation blockers.

Deferred register stays in PHASE_0 §15: D1 matching/data; D2 lifecycle; D3 privacy defaults; D4 phone/badge operations; D5 moderation; D6 invitation/history; D7 legal retention; D8 providers/runtime/ops; D9 analytics. Phase 3 resolves only its taxonomy/preferences/availability/completeness and discovery subset. Phase 4 resolves pre-hiring Job state/edit preparation and coarse ads. Phase 5 resolves required ordinary hiring cancellation, revision/expiry, pending offers after CLOSED, explicit completion, capacity and real material-edit facts; no disputes/admin force actions. Exact workplace/contact disclosure, matching, moderation and legal retention remain deferred. Stop for Phase 5 review. Phase 6 and deployment need separate authorization; no upload was needed.
