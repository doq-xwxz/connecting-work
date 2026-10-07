# Database foundation

[PRODUCT](PRODUCT.md) is source of truth; [PHASE_0 §6](PHASE_0.md#6-conceptual-database-schema) is the conceptual domain design. No Worker/Employer/Company/Job/Application or other marketplace tables exist in Phase 1.

## Current implementation

PostgreSQL only, Prisma 7 with pg driver adapter and generated TypeScript client ignored under `src/generated/prisma`. The initial FoundationCheck probe was removed through `20261007020000_remove_foundation_check` after real smoke and auth integration passed. The smoke now creates/reads a transient User, checks default status/verification/no roles, and rolls back. No shared DB reset or persistent fixture is needed.

`prisma.config.ts` loads Next-style env precedence (`.env.local` then `.env`) and selects `DIRECT_DATABASE_URL` for migrations when set, otherwise DATABASE_URL. Generation/validation do not need a server or credentials. `shared/db/client.ts` reads DATABASE_URL lazily, is server-only, caches locally across HMR and uses pool max 5, connection timeout 5s, idle timeout 30s. No pool shutdown per HTTP request. CLI disconnects on exit.

## Local migration workflow

Phase 2 adds User, Session, Account, Verification, UserRole, RateLimit and Role/AccountStatus enums in `20261007010000_auth`. No marketplace table is introduced. Better Auth owns password hashing, session tokens and verification/reset lifecycle. User.status is server-owned; roles are a separate compound-primary-key relation, never a user-editable Better Auth field. UserRole.grantedBy records the opaque self-actor or operational change reference. RateLimit is DB-backed for cross-instance counters. Session/Account cascade only auth credentials on actual User deletion; UserRole restricts deletion. Public account-deletion APIs are not enabled; future historical domain relations must not cascade away.

The cleanup migration drops only FoundationCheck. The original Foundation and Auth migrations remain unchanged. All three migrations applied successfully; auth/smoke were rerun after removal. See PHASE_2 for real PostgreSQL evidence and the earlier historical blockers.

The auth SQL was originally generated offline from the committed Phase 1 schema and reviewed for additive-only changes. Real application/status and the resulting auth schema were subsequently verified on disposable PostgreSQL 18.6; offline SQL comparison alone was not treated as live evidence.

Use a **disposable local/development PostgreSQL database** supplied by its operator; `.env.example` contains commented placeholders, not working credentials. Store the actual DATABASE_URL in ignored `.env.local` or process env. If the migration endpoint must be direct, set DIRECT_DATABASE_URL too. Do not use production credentials.

1. `pnpm install --frozen-lockfile`
2. `pnpm db:generate` and `pnpm db:validate`
3. `pnpm db:deploy` applies committed migrations to the selected disposable database; use `pnpm db:migrate --name <change>` only when authoring a new schema migration.
4. `pnpm db:status`
5. `pnpm db:smoke` verifies SELECT 1 plus generated-client User CRUD and rolls its row back; exit 2 means missing DATABASE_URL, exit 1 means connection/migration/config failure. No URLs/driver errors printed.

For applying reviewed committed migrations to a disposable/staging database, `pnpm db:deploy`. No deploy command is run by CI. Never use `db push` as the committed migration workflow. `migrate dev` needs a shadow database/create-database permission (or later explicit shadow configuration); `migrate deploy` applies existing SQL without generating changes. Never run reset on user data.

Before production: rehearse migrations/backfills, assess locks, backup/restore and rollback plan. pg adapter pool applies **per app process/instance**, not global across serverless fleet. Set max instances/pool capacity against provider budget; use provider-recommended transaction pooling for app traffic/direct migration endpoint, TLS verified according to provider, regions aligned. No provisioning or PgBouncer/Redis installed now.

## Future approved constraints / deferred schemas

Company ownership survives creator departure; OWNER/MANAGER current membership. Lifetime UNIQUE(jobId,workerId); one pending Offer/Application; atomic accept+Engagement; immutable snapshots; capacity counts accepted/in-progress/completed; quota counts published/paused per owner. Reviews UNIQUE(engagementId,direction) with stable WorkerProfile/EmployerProfile/Company subject and actor provenance, sample-count aggregates rebuildable. Conversations require application or accepted invitation and current participant entitlement.

Future FKs/checks/partial indexes/lock ordering are design proposals in PHASE_0, introduced only in owning phase. Avoid naive cascading deletion of transactional/audit history; support future soft deletion/anonymization, precise legal periods D7 before production. No CV/identity/business document schemas. Outbox only Phase 7, media only avatar/logo when needed. D1/D2/D3 remain deferred, not encoded early.

## Integration test convention

Use actual PostgreSQL, never SQLite. Phase 2 provides `pnpm test:integration` and `pnpm test:http`. Configure TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable explicitly; DATABASE_URL is never silently reused. Apply committed migrations to that same disposable database first (`pnpm db:deploy`, with DATABASE_URL/DIRECT_DATABASE_URL scoped to that disposable endpoint), then `pnpm db:status`. Never point these at production. Tests generate random transient accounts/passwords and unique documentation-only IPv6 client networks, keeping production rate limits enabled. They clean up only their own users/roles/verification records and rate-limit keys; no database reset or global counter deletion. No tokens/URLs/provider bodies are printed and no real email is sent.

Verified coverage: signup/duplicate safety, verification/expired token, login/fixation, PostgreSQL session persistence across auth objects, dual roles/concurrent duplicates, ADMIN rejection, fresh suspension checks, logout invalidation, reset/expiry/reuse/session revocation, unknown-account response and persisted rate limits. The HTTP harness starts the actual Next development server on a temporary loopback port, runs the account/API flow and stops it. A test-only preload redirects Resend transport to an authenticated in-memory loopback inbox; it never changes application auth or DB behavior and is not a runtime dependency. GitHub Actions now runs these checks against a fresh PostgreSQL 18 service with disposable job-only credentials. Future business DB suites may use tests/integration; locking tests need independent real connections. Unit tests do not instantiate DB.

For Neon/cloud hosts, DATABASE_URL must use the provider's pooled endpoint for runtime traffic, DIRECT_DATABASE_URL its direct endpoint for migrations, and TEST_DATABASE_URL a separate disposable database/branch. Local disposable verification used a real local server with pg's bounded connection pool, not Neon/PgBouncer; provider TLS, transaction-pool compatibility and deployment-specific proxy configuration must still be verified when that environment is provisioned.
