# Implementation roadmap

[PRODUCT](PRODUCT.md) is source of truth; [PHASE_0 §13](PHASE_0.md#13-implementation-roadmap) holds objectives, PR slices, tests and Definition of Done. This file tracks execution without silently approving deferred D1–D9.

| Phase | Objective / dependency | Deliverables / test gate | Status |
|---|---|---|---|
| 0 | Planning and review | Approved product/architecture and deferred register | Complete |
| 1 | Foundation, user authorized | App/tooling, governance, env/DB client, minimal probe migration/smoke, safe errors/logs, unit/CI, honest shell. Install/lint/typecheck/tests/build; DB separately verified or explicitly blocked | See PHASE_1.md for evidence/remaining issues |
| 2 | Auth/authorization after 1 review | Better Auth email/password/verify/reset, dual roles, operational admin, scoped suspension; auth/negative tests | Not authorized |
| 3 | Profiles/company after 2; D1 data/D3 | Structured profiles/privacy/availability, OWNER/MANAGER, minimum apply completeness, avatar/logo only if needed; DTO/revocation tests | Planned |
| 4 | Jobs after 3; D2 | Structured draft, lifecycle/material-lock/duplicate/atomic quota; race/state tests | Planned |
| 5 | Hiring after 4; D2 | Application/immutable offer revisions/atomic accept/engagement/dispute; capacity, unique, snapshots and E2E | Planned |
| 6 | Search/matching after data/hiring; D1/D3 | PG FTS/filters/score+coverage/opt-in discovery; normalization/privacy/performance tests | Planned |
| 7 | Communication after hiring; D6/D8 | Accepted invitation, block exceptions, polling, inbox/email/outbox retries; access/dedupe tests | Planned |
| 8 | Reviews after engagement; D1 | Per-completed-Engagement/direction/subject immutable reviews, sample-count rebuild; eligibility tests | Planned |
| 9 | Trust/admin after owning modules; D5 | Risk/reports/badges/moderation/operational admin, case-bound FORCE audit; escalation tests | Planned |
| 10 | Hardening after 1–9 | Full threat/auth matrix, privacy/cache/media/rate/concurrency/secret checks; resolve critical/high issues | Planned |
| 11 | Metrics after lifecycle facts; D9 | Completed Engagements, relevance eligibility+score70+coverage60, versioned 3/24h liquidity, PII-safe monitoring; denominator/history tests | Planned |
| 12 | Production readiness; D4/D7/D8/D9 | Legal/phone policy, backups/restore/rollback/migration rehearsal/provider outage/E2E/accessibility/ops signoff | Planned; deployment separately authorized |

Each phase splits into reviewable PR-sized changes per PHASE_0, not one all-feature scaffold. Security/verified-email gates/audit timestamps belong to the phase introducing that activity; later hardening is verification, not first protection. No full outbox until Phase 7, enterprise capability engine, document management, malware pipeline, WebSocket, Redis, microservice or external search during Foundation. Legal retention durations/phone provider are not Foundation blockers.

Deferred register stays in PHASE_0 §15: D1 matching/data; D2 ordinary cancellation/job-finalization; D3 privacy defaults; D4 public phone/company badge operations; D5 moderation; D6 invitation/history; D7 legal retention; D8 providers/runtime/ops; D9 analytics windows/cohorts. Runtime versions selected in Phase 1 resolve only that part of D8.
