# Repository instructions

Before business-logic changes, read in order: [PRODUCT.md](PRODUCT.md), [PHASE_0.md](PHASE_0.md), [ARCHITECTURE.md](ARCHITECTURE.md), then relevant domain documentation. PRODUCT is product source of truth; PHASE_0 records approved decisions and deferred D1–D9. Do not reopen approved choices without a real implementation contradiction.

## Current authorization

Phase 2 implementation and real PostgreSQL/auth closure verification are authorized. Read PHASE_1.md and PHASE_2.md as evidence in addition to the context order above. Phase 2 requires real migrations, DB smoke, auth integration and HTTP flow evidence before closure. Stop for Phase 2 closure review; do not start Phase 3, add marketplace schemas/features or deploy. PRODUCT and the approved Phase 0 record remain intact.

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

Phase 2 permits only Better Auth email/password/verification/reset, DB-backed sessions, identity roles/status, guarded account UI and reusable server authorization. No social providers, marketplace domain schema, outbox, enterprise capabilities, general document management, malware pipeline, WebSockets, Redis, microservices, external search, payments or AI. ADMIN must never be accepted from user input. D1–D9 remain deferred except previously recorded runtime choices. Suspended authentication is distinct from permission to create activity; future active-obligation checks belong to resource services. Do not invent BANNED semantics beyond scoped fail-closed guards. Production origins/secrets come from deployment env; never depend on the operator PC.

## Validation and delivery

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `pnpm db:validate` validates schema without DB. For a configured disposable PostgreSQL use documented migration+smoke commands, `pnpm test:integration` and `pnpm test:http`, never a production URL or SQLite. The HTTP harness intercepts only email transport in its development child process; never import its preload into application code or production runtime. FoundationCheck was removed only after real smoke and auth integration passed; smoke now rolls back a transient User. Report missing DB as BLOCKED. Review tracked and new files, ignored secret paths, dependency changes and git diff. Never commit generated clients, credentials, local env or test data. Update docs when architecture or verified setup changes. Stop at the authorized phase and report remaining issues.

Auth entrypoints, factory and DB services are server-only. Real session checks and fresh role/status reads authorize each request; role activation rechecks status under a PostgreSQL row lock. Future moderation must lock that same user row. Keep strict input/origin/endpoint allowlists; public auth GET routes must not mutate identity. Auth mail tokens use URL fragments and POST confirmation; never add token logging or production in-memory email/session persistence. Integration tests require explicit TEST_DATABASE_URL + AUTH_TEST_DATABASE=disposable and committed migrations. Keep trusted ADMIN provisioning operational and reviewed, never expose a grant API.
