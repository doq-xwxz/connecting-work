# Repository instructions

Before business-logic changes, read in order: [PRODUCT.md](PRODUCT.md), [PHASE_0.md](PHASE_0.md), [ARCHITECTURE.md](ARCHITECTURE.md), then relevant domain documentation. PRODUCT is product source of truth; PHASE_0 records approved decisions and deferred D1–D9. Do not reopen approved choices without a real implementation contradiction.

## Current authorization

Phases 0–3 are approved. Phase 4 Jobs, publishing/lifecycle, personal/Company ownership, atomic active-job quota, duplication and public/coarse job discovery are authorized. Read PHASE_1.md–PHASE_3.md as historical evidence and PHASE_4.md for current implementation. Stop after Phase 4 review; no Applications, Offers, Engagements, hiring, matching, messaging, uploads, moderation, Phase 5 or deployment. PRODUCT and approved historical reports/migrations remain intact.

Standing user instruction (2026-10-07): after completing authorized changes and appropriate validation, automatically commit and push those changes to https://github.com/doq-xwxz/connecting-work on the current branch (currently main), without asking the user to repeat publication authorization. Verify the remote commit and relevant GitHub Actions results. Review the staged diff first; exclude credentials, local env, generated artifacts and unrelated changes. Do not force-push or rewrite history. Report any authentication, permission, remote conflict or CI blocker honestly. This instruction authorizes GitHub publication, not additional product scope or deployment.

## Boundaries

- Use pnpm exclusively; supported Node 24; preserve the lockfile. Run lint, typecheck, tests, build after relevant changes. Prisma generation is part of typecheck/build.
- `src/app` is transport/presentation; client components must not import DB, secrets or server-only services. Server authorization must check actor, role, current ownership/membership, resource state and field visibility.
- Future modules expose public services/query DTOs. Services own policies, transactions and invariants. Other modules must not import their repositories. Do not add empty business implementations.
- Use Zod for runtime boundary validation. Parse explicit inputs and return safe field errors, never raw validation issues containing sensitive data. Shared error output is allowlisted; no stack/SQL/cause/internal messages.
- Logs accept static action names and opaque IDs, never PII/passwords/tokens/payloads. Do not pass user text as an identifier. Business audit is separate and belongs to its owning phase.

## Approved invariants for later phases

Normal Worker/Employer roles coexist; ADMIN is trusted operational provision only. Company-owned jobs remain company property after creator departure; V1 membership OWNER/MANAGER only. Lifetime unique apply, immutable offer/work terms, atomic capacity/quota, engagement-based immutable reviews, accepted-invitation chat, opted-in Employer-only worker discovery and active-obligation block/suspension exceptions are mandatory. See PRODUCT rather than duplicating full rules here.

## Scope and decisions

Phase 4 resolves only required D2 job-state/edit preparation and D3 coarse job visibility. Company ownership derives from current membership, never creator provenance. Sensitive Job writes lock/recheck User → Company or personal EmployerProfile quota owner → Job; membership removal takes the same Company lock. PUBLISHED+PAUSED count toward three active jobs independently per personal EmployerProfile/Company. Draft creation/edit may be unverified; publish/resume require fresh verified email. SUSPENDED/BANNED deny new recruiting activity but allow authorized pause/close/cancel to reduce exposure. CLOSED cannot reopen; COMPLETED has no Phase 4 action. Material edit policy is prepared explicitly for real Phase 5 Application/Engagement checks, with no fake tables/counts. No invitations/member-add/transfer, outbox, enterprise RBAC, documents, WebSockets, Redis, microservices, external search, payments or AI. Worker discovery defaults off; no ADMIN bypass. Production state/origins/secrets remain cloud/env based.

## Validation and delivery

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `pnpm db:validate` validates schema without DB. For a configured disposable PostgreSQL use documented migration+smoke commands, `pnpm test:integration`, `pnpm test:profiles`, `pnpm test:jobs` and `pnpm test:http`, never a production URL or SQLite. The HTTP harness intercepts only email transport in its development child process; never import its preload into application code or production runtime. FoundationCheck was removed only after real smoke and auth integration passed; smoke now rolls back a transient User. Report missing DB as BLOCKED. Review tracked and new files, ignored secret paths, dependency changes and git diff. Never commit generated clients, credentials, local env or test data. Update docs when architecture or verified setup changes. Stop at the authorized phase and report remaining issues.

Auth entrypoints, factory and DB services are server-only. Real session checks and fresh role/status reads authorize each request; role activation rechecks status under a PostgreSQL row lock. Future moderation must lock that same user row. Keep strict input/origin/endpoint allowlists; public auth GET routes must not mutate identity. Auth mail tokens use URL fragments and POST confirmation; never add token logging or production in-memory email/session persistence. Integration tests require explicit TEST_DATABASE_URL + AUTH_TEST_DATABASE=disposable and committed migrations. Keep trusted ADMIN provisioning operational and reviewed, never expose a grant API.
