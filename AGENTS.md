# Repository instructions

Before business-logic changes, read in order: [PRODUCT.md](PRODUCT.md), [PHASE_0.md](PHASE_0.md), [ARCHITECTURE.md](ARCHITECTURE.md), then relevant domain documentation. PRODUCT is product source of truth; PHASE_0 records approved decisions and deferred D1–D9. Do not reopen approved choices without a real implementation contradiction.

## Current authorization

Phase 1 Foundation only is authorized. Do not proceed to Phase 2 or implement marketplace features without a new user instruction. Foundation covers app/tooling, minimal PostgreSQL/Prisma setup, validation/errors/logger/tests/CI and documentation. No deployment or push is implied. PRODUCT and the approved Phase 0 record remain intact.

## Boundaries

- Use pnpm exclusively; supported Node 24; preserve the lockfile. Run lint, typecheck, tests, build after relevant changes. Prisma generation is part of typecheck/build.
- `src/app` is transport/presentation; client components must not import DB, secrets or server-only services. Server authorization must check actor, role, current ownership/membership, resource state and field visibility.
- Future modules expose public services/query DTOs. Services own policies, transactions and invariants. Other modules must not import their repositories. Do not add empty business implementations.
- Use Zod for runtime boundary validation. Parse explicit inputs and return safe field errors, never raw validation issues containing sensitive data. Shared error output is allowlisted; no stack/SQL/cause/internal messages.
- Logs accept static action names and opaque IDs, never PII/passwords/tokens/payloads. Do not pass user text as an identifier. Business audit is separate and belongs to its owning phase.

## Approved invariants for later phases

Normal Worker/Employer roles coexist; ADMIN is trusted operational provision only. Company-owned jobs remain company property after creator departure; V1 membership OWNER/MANAGER only. Lifetime unique apply, immutable offer/work terms, atomic capacity/quota, engagement-based immutable reviews, accepted-invitation chat, opted-in Employer-only worker discovery and active-obligation block/suspension exceptions are mandatory. See PRODUCT rather than duplicating full rules here.

## Scope and decisions

Do not build auth flows, domain schemas, outbox, enterprise capabilities, general document management, malware pipeline, WebSockets, Redis, microservices, external search, payments or AI during Foundation. No CV/identity/business document uploads V1. D1–D9 are deferred; do not silently approve them. Legal durations and phone provider are not Foundation blockers. Add each infrastructure item only when an authorized phase needs it.

## Validation and delivery

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `pnpm db:validate` validates schema without DB. For a configured disposable PostgreSQL use documented migration+smoke commands, never a production URL or SQLite. Report missing DB as BLOCKED. Review all new files (initial repository has no commit), ignored secret paths, dependency changes and git diff. Never commit generated clients, credentials, local env or test data. Update docs when architecture or verified setup changes. Stop at the authorized phase and report remaining issues.
