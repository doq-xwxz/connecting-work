# Architecture

Read [PRODUCT](PRODUCT.md) and [PHASE_0](PHASE_0.md) first. APPROVED is product/architecture decision; DESIGN PROPOSAL is implementation guidance; DEFERRED refers to Phase 0 D1–D9. Phases 0–3 are approved. Phase 4 adds Jobs; stop for Phase 4 review. Phase 5 and deployment are not authorized.

## Approved direction

Next.js App Router + TypeScript strict + PostgreSQL/Prisma, Tailwind/shadcn, modular monolith. Better Auth email/password with verified email gates belongs to Phase 2. Normal dual profiles, operational admin, optional company job ownership, split Application/Offer/Engagement, immutable terms, atomic quota/capacity, per-engagement reviews, job-scoped accepted-invitation chat/polling and privacy policies remain approved, not reopened.

## Foundation implementation

`src/app` contains presentation/HTTP adapters. `src/components/ui` documents shadcn manual setup; tokens/config/utils exist, no unused primitive set. `src/modules/README.md` defines module boundaries. `src/shared/config` contains Zod env parsing and server-only env reader; `shared/db/client.ts` is lazy/server-only with hot-reload reuse and bounded pg pool; `shared/errors` provides client-safe categories; `shared/logging` fixed-field JSON events; `shared/ui` class merging. `scripts/db-smoke.ts` is an operator-only check, not an HTTP endpoint.

Landing/auth UI and build require no DB or provider env. Actual auth validates runtime config lazily; actual Job data requires migrated runtime PostgreSQL. No secrets are read in Client Components. Local system fonts avoid build-time remote downloads. No middleware pretending auth exists.

## Phase 2 implementation

`modules/auth` owns a server-only Better Auth factory/entrypoint, strict HTTP boundary, session-to-current-principal service, controlled normal-role grants and pure policy/config helpers. The app uses same-origin POST fetches against the Better Auth HTTP handler; it does not implement its own credential/session protocol. `shared/email` defines the auth-mail interface and native-fetch Resend adapter. Only tests use fake in-memory delivery. Next `after` retains provider background work on managed hosts; failures produce only a fixed safe event. No notification/outbox service exists.

Authentication uses PostgreSQL sessions with cookie cache disabled. Each protected account request validates a real session and reads current roles/status from the DB. Role activation derives user ID from that session and locks/rechecks User in a transaction before idempotent upsert. Policies distinguish authenticated account access, any-of role checks, verified email and ACTIVE new-activity eligibility. Future ownership/company/resource-state checks remain in their owning services, not a speculative permission engine. ADMIN has no public grant path; BANNED full semantics remain D5.

The public auth endpoint surface is explicitly allowlisted. Verification email links open a page with a token fragment; user confirmation POST invokes Better Auth's internal verification handler. No public mutating verification GET, token URL access logs, external redirect input or raw auth result DTO. `/account` is dynamic/server-checked; UI redirects and disabled controls are UX only. Production uses explicit HTTPS APP_URL, injected secret and cloud PostgreSQL; `pnpm start` has no loopback binding assumption. Real DB/auth and actual Next HTTP evidence passed; see the approved [PHASE_2](PHASE_2.md) report.

## Phase 3 implementation

`modules/profiles` owns explicit Zod contracts, server-only services and self/discovery DTOs for WorkerProfile, EmployerProfile, controlled Skill/WorkerSkill, normalized preferences/work modes and hourly weekly availability. Completeness is computed from required fields on each read/save, never persisted or accepted from the client. `profiles/access.ts` exposes a transaction-scoped EmployerProfile prerequisite to Company services; no cross-module repository import exists. `modules/companies` owns Company/CompanyMember, role policy, atomic company/OWNER creation, stable random-suffix slugs, idempotent creation keys, current-membership management and OWNER-only removal of MANAGER. Slug uniqueness conflicts retry the whole transaction at most three times.

Sensitive mutations lock/re-read User first (shared with normal-role grants), then Company where applicable, then re-read current membership/resource. Removing a MANAGER takes that same Company lock. Status/role/membership are never trusted from a cached principal or creator provenance. Company rows survive creator departure. No public member-add, invitation, ownership-transfer, verification or admin-bypass endpoint exists; initial OWNER is atomic and cannot be removed through public APIs. Future membership/moderation writers must preserve this lock protocol.

The dynamic Node `/api/marketplace/[...path]` adapter accepts only explicit method/path/body/query combinations, real authenticated sessions and same-origin mutations. `/worker/profile`, `/employer/profile`, `/employer/workers` and `/employer/companies` call the same services from server rendering; interactive forms receive allowlisted DTOs only. Private pages and APIs use no-store; profile/company pages use no-referrer. Discovery is private, ACTIVE EMPLOYER + EmployerProfile only; target must remain ACTIVE WORKER and explicitly opted in. No contacts, identity IDs, raw schedule/timezone, bio or private status are projected. Queries use indexed filters with ordered cursor pages (default 12, max 30); no matching/ranking or public directory.

Phase 3 resolves only the D1 taxonomy/preferences/availability/completeness and D3 defaults/coarse discovery projection described in PHASE_3. New activity fails closed for SUSPENDED/BANNED; own read access and privacy opt-out remain. There are no active hiring obligations in this phase. Real PostgreSQL tests use independent pool connections and observe actual lock waits before committing revocation/suspension; HTTP tests run real Next/Better Auth/PostgreSQL. Only test email transport is intercepted.

## Phase 4 implementation

`modules/jobs` owns explicit contracts, pure lifecycle/ownership/completeness/quota/material-edit policies, allowlisted projections and server-only transactional services. App adapters and client leaves never import repositories or DB clients. Current EmployerProfile is required; personal ownership uses its ID, company ownership uses current OWNER/MANAGER membership. Creator provenance conveys no company authority. Verified email gates publish/resume and active-term edits; unverified ACTIVE employers can prepare drafts. SUSPENDED/BANNED may read owned records and pause/close/cancel to reduce exposure, but cannot create/edit/duplicate/publish/resume.

Every sensitive write locks/rechecks User, then the Company or personal EmployerProfile owner row, then an existing Job. Company revocation takes the same Company lock. Count PUBLISHED+PAUSED under that owner lock before publication/resumption: three per personal profile, separately three per company, irrespective of creator. The optimistic version rejects stale edits/actions. Creation/duplication keys are actor-bound retry keys; they do not grant authority. Children and scalar terms are saved atomically. Trusted future writers must use these locks too; DB quota is a transactional service invariant, not a CHECK across rows.

Public `GET /api/marketplace/jobs` and `/jobs/:id` project only PUBLISHED ads. Private `/api/marketplace/employer-jobs` separates management DTOs and explicit POST lifecycle actions. All queries are bounded UUID cursor pages; no ranking/search engine. Public owner display includes Company name/slug/badge or personal display name, never owner identity IDs, contacts, membership or status. Job ad text is employer-supplied and escaped, not automatically PII-redacted. No exact address is stored. Public listing is status-based; automatic hiding on owner suspension remains D5, with restrictive owner actions already available.

`JobTerms` v1 is an explicit JSON-serializable contract (money as integer strings, date-only ISO strings, normalized skill/schedule arrays). No snapshots are persisted yet. Only description wording is classified non-material; other recruiting terms are conservatively material. The policy has explicit PRE_HIRING versus HIRING contexts. Phase 4 uses structural PRE_HIRING because Application/Engagement tables do not exist; Phase 5 must load real application/occupied-slot facts under the Job lock and activate the guard. No fake count column or application service exists. CLOSED/CANCELLED/COMPLETED are terminal; COMPLETED has no ordinary Phase 4 transition. No scheduled auto-completion.

See [PHASE_4](PHASE_4.md) for decisions, live evidence and deferred hiring effects.

## Future boundaries — design proposal

Worker/employer/admin route groups introduced only in owning phases. Server Actions/Route Handlers validate/authenticate and call services. Services recheck ownership/current company membership/state in scoped queries/transactions; repositories never authorize browser-supplied IDs alone. Return DTO allowlists, not raw Prisma entities. Client components are only interactive leaves. Cross-module calls use public contracts/services; applications owns hiring orchestration.

Phase 3 verifies User→Company lock ordering and membership revocation on PostgreSQL. Hiring idempotency/capacity/immutable snapshot races remain Phase 5. No generic domain locking framework exists. Notifications outbox is proposed for Phase 7, built only when durable delivery is implemented. Future email/storage/search/transport adapters remain replaceable without moving product rules into providers. Company conversation/review subjects use stable owner entities, not creator user IDs.

Suspension/block is action+resource policy: deny new activity while preserving required active-obligation access; no blanket UI/session gate. Admin FORCE actions require case/reason/actor/time/immutable audit. Full authorization and audit services are not implemented in Foundation.

## Decisions and references

Zod is selected for ingress validation by Phase 1 instruction; Vitest for Node unit tests; pnpm exclusively. Exact installed versions and evidence are recorded in PHASE_1.md and lockfile. D8 package/runtime choice resolved for Foundation; provider/ops budget decisions remain deferred. Phase 3 resolves only its D1/D3 subset; Phase 4 only pre-hiring D2 state/edit preparation and D3 coarse Job ads. D1 scoring, remaining D3 matching/contact policies, dependent D2 hiring cancellation/job-finalization, D4 public phone policy, D5 moderation, D6 invitation/history, D7 legal retention and D9 metric windows remain deferred.

References used for setup: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql), [Prisma connections](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections), [shadcn manual setup](https://ui.shadcn.com/docs/installation/manual). New decisions must record status/context/options/consequences, and product changes require explicit review.
