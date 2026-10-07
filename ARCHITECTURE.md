# Architecture

Read [PRODUCT](PRODUCT.md) and [PHASE_0](PHASE_0.md) first. APPROVED is product/architecture decision; DESIGN PROPOSAL is implementation guidance; DEFERRED refers to Phase 0 D1–D9. Phase 1 is a local Foundation, not a launched marketplace.

## Approved direction

Next.js App Router + TypeScript strict + PostgreSQL/Prisma, Tailwind/shadcn, modular monolith. Better Auth email/password with verified email gates belongs to Phase 2. Normal dual profiles, operational admin, optional company job ownership, split Application/Offer/Engagement, immutable terms, atomic quota/capacity, per-engagement reviews, job-scoped accepted-invitation chat/polling and privacy policies remain approved, not reopened.

## Foundation implementation

`src/app` contains server-rendered root layout and honest placeholder. `src/components/ui` documents shadcn manual setup; tokens/config/utils exist, no unused primitive set. `src/modules/README.md` defines future module API boundary, no domain files. `src/shared/config` contains Zod env parsing and server-only env reader; `shared/db/client.ts` is lazy/server-only with hot-reload reuse and bounded pg pool; `shared/errors` provides client-safe categories; `shared/logging` fixed-field JSON events; `shared/ui` class merging. `scripts/db-smoke.ts` is an operator-only check, not an HTTP endpoint.

App UI/build require no DB or future-provider env. DB initialization validates its config when actually requested. No secrets are read in Client Components. Local system fonts avoid build-time remote downloads. No middleware pretending auth exists.

## Future boundaries — design proposal

Worker/employer/admin route groups introduced only in owning phases. Server Actions/Route Handlers validate/authenticate and call services. Services recheck ownership/current company membership/state in scoped queries/transactions; repositories never authorize browser-supplied IDs alone. Return DTO allowlists, not raw Prisma entities. Client components are only interactive leaves. Cross-module calls use public contracts/services; applications owns hiring orchestration.

Transactional lock ordering, idempotency and immutable snapshots require PostgreSQL tests at Phase 5. No domain locking framework now. Notifications outbox proposed for Phase 7, built only when durable delivery requirement is implemented. Future email/storage/search/transport adapters remain replaceable without moving product rules into providers. Company conversation/review subjects use stable owner entities, not creator user IDs.

Suspension/block is action+resource policy: deny new activity while preserving required active-obligation access; no blanket UI/session gate. Admin FORCE actions require case/reason/actor/time/immutable audit. Full authorization and audit services are not implemented in Foundation.

## Decisions and references

Zod is selected for future ingress validation by Phase 1 instruction; Vitest for Node unit tests; pnpm exclusively. Exact installed versions and evidence are recorded in PHASE_1.md and lockfile. D8 package/runtime choice resolved for Foundation; provider/ops budget decisions remain deferred. D1 scoring details, D2 cancellation/job-finalization, D3 privacy defaults, D4 public phone policy, D5 moderation, D6 invitation/history, D7 legal retention and D9 metric windows are still deferred.

References used for setup: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql), [Prisma connections](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections), [shadcn manual setup](https://ui.shadcn.com/docs/installation/manual). New decisions must record status/context/options/consequences, and product changes require explicit review.
