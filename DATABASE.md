# Database foundation

[PRODUCT](PRODUCT.md) is source of truth; [PHASE_0 §6](PHASE_0.md#6-conceptual-database-schema) is the conceptual domain design. No Worker/Employer/Company/Job/Application or other marketplace tables exist in Phase 1.

## Current implementation

PostgreSQL only, Prisma 7 with pg driver adapter and generated TypeScript client ignored under `src/generated/prisma`. One infrastructure-only `FoundationCheck` table supports a real initial migration and transactional CRUD smoke. It carries only an integer id and checkedAt; smoke inserts/reads and rolls back, retaining no business/test payload. This tiny probe verifies ORM+migration wiring without choosing domain schemas. It can be removed through a reviewed migration once domain integration coverage replaces it; do not reset a shared DB.

`prisma.config.ts` loads Next-style env precedence (`.env.local` then `.env`) and selects `DIRECT_DATABASE_URL` for migrations when set, otherwise DATABASE_URL. Generation/validation do not need a server or credentials. `shared/db/client.ts` reads DATABASE_URL lazily, is server-only, caches locally across HMR and uses pool max 5, connection timeout 5s, idle timeout 30s. No pool shutdown per HTTP request. CLI disconnects on exit.

## Local migration workflow

Phase 2 adds User, Session, Account, Verification, UserRole, RateLimit and Role/AccountStatus enums in `20261007010000_auth`. No marketplace table is introduced. Better Auth owns password hashing, session tokens and verification/reset lifecycle. User.status is server-owned; roles are a separate compound-primary-key relation, never a user-editable Better Auth field. UserRole.grantedBy records the opaque self-actor or operational change reference. RateLimit is DB-backed for cross-instance counters. Session/Account cascade only auth credentials on actual User deletion; UserRole restricts deletion. Public account-deletion APIs are not enabled; future historical domain relations must not cascade away.

FoundationCheck is retained temporarily because the live DB smoke has never passed and still provides a credential-free rollback probe independent of auth setup. It is not a permanent business table. Remove it with a separate reviewed migration after real auth integration coverage passes; no reset/drop is performed in Phase 2.

The auth SQL was generated offline from the committed Phase 1 schema to current schema and reviewed for additive-only changes. Re-generating it produces the same SQL. Applying it and checking live migration status remain BLOCKED without PostgreSQL. An offline SQL comparison does not prove live migration validity.

Use a **disposable local/development PostgreSQL database** supplied by its operator; `.env.example` contains commented placeholders, not working credentials. Store the actual DATABASE_URL in ignored `.env.local` or process env. If the migration endpoint must be direct, set DIRECT_DATABASE_URL too. Do not use production credentials.

1. `pnpm install --frozen-lockfile`
2. `pnpm db:generate` and `pnpm db:validate`
3. `pnpm db:migrate --name foundation` for a development database (applies existing migrations and creates a new migration only for a schema change).
4. `pnpm db:status`
5. `pnpm db:smoke` verifies SELECT 1 plus generated-client CRUD and rolls its row back; exit 2 means missing DATABASE_URL, exit 1 means connection/migration/config failure. No URLs/driver errors printed.

For applying reviewed committed migrations to a disposable/staging database, `pnpm db:deploy`. No deploy command is run by CI. Never use `db push` as the committed migration workflow. `migrate dev` needs a shadow database/create-database permission (or later explicit shadow configuration); `migrate deploy` applies existing SQL without generating changes. Never run reset on user data.

Before production: rehearse migrations/backfills, assess locks, backup/restore and rollback plan. pg adapter pool applies **per app process/instance**, not global across serverless fleet. Set max instances/pool capacity against provider budget; use provider-recommended transaction pooling for app traffic/direct migration endpoint, TLS verified according to provider, regions aligned. No provisioning or PgBouncer/Redis installed now.

## Future approved constraints / deferred schemas

Company ownership survives creator departure; OWNER/MANAGER current membership. Lifetime UNIQUE(jobId,workerId); one pending Offer/Application; atomic accept+Engagement; immutable snapshots; capacity counts accepted/in-progress/completed; quota counts published/paused per owner. Reviews UNIQUE(engagementId,direction) with stable WorkerProfile/EmployerProfile/Company subject and actor provenance, sample-count aggregates rebuildable. Conversations require application or accepted invitation and current participant entitlement.

Future FKs/checks/partial indexes/lock ordering are design proposals in PHASE_0, introduced only in owning phase. Avoid naive cascading deletion of transactional/audit history; support future soft deletion/anonymization, precise legal periods D7 before production. No CV/identity/business document schemas. Outbox only Phase 7, media only avatar/logo when needed. D1/D2/D3 remain deferred, not encoded early.

## Integration test convention

Use actual PostgreSQL, never SQLite. Phase 2 provides `pnpm test:integration` through scripts/auth-integration.ts. Configure TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable explicitly; DATABASE_URL is never silently reused. Apply committed migrations to that same disposable database first (`pnpm db:deploy`, with DATABASE_URL/DIRECT_DATABASE_URL scoped to that disposable endpoint), then `pnpm db:status`. Never point these at production. The test generates random transient account/password data, uses Better Auth + real Prisma/PostgreSQL and fake mail delivery, and cleans up only its own users/roles/verification records. Rate-limit counters remain, so repeat runs within one minute may be throttled. It never resets the DB and never prints tokens/URLs/provider bodies. No real email is sent.

Coverage authored: signup, verification/expired token, login/fixation, DB session persistence, dual roles/concurrent duplicate grants, ADMIN rejection, fresh suspension checks, logout/session reuse, reset/expiry/reuse and reset-session revocation. This suite is BLOCKED until a disposable endpoint is supplied; authored tests are not a claimed PASS. The default CI remains offline because the suite has not yet been exercised against the operator's isolated PostgreSQL environment. Keep it separate until that first real run; then a PostgreSQL CI job can run the same command without production/provider secrets. Future business DB suites may use tests/integration; locking tests need independent real connections. Unit tests do not instantiate DB.
