# Database foundation

[PRODUCT](PRODUCT.md) is source of truth; [PHASE_0 §6](PHASE_0.md#6-conceptual-database-schema) is the conceptual domain design. Phase 4 adds Job/JobSkill/JobScheduleWindow; Application, Offer and Engagement tables do not exist.

## Current implementation

PostgreSQL only, Prisma 7 with pg driver adapter and generated TypeScript client ignored under `src/generated/prisma`. The initial FoundationCheck probe was removed through `20261007020000_remove_foundation_check` after real smoke and auth integration passed. The smoke now creates/reads a transient User, checks default status/verification/no roles, and rolls back. No shared DB reset or persistent fixture is needed.

`prisma.config.ts` loads Next-style env precedence (`.env.local` then `.env`) and selects `DIRECT_DATABASE_URL` for migrations when set, otherwise DATABASE_URL. Generation/validation do not need a server or credentials. `shared/db/client.ts` reads DATABASE_URL lazily, is server-only, caches locally across HMR and uses pool max 5, connection timeout 5s, idle timeout 30s. No pool shutdown per HTTP request. CLI disconnects on exit.

## Local migration workflow

Phase 2 adds User, Session, Account, Verification, UserRole, RateLimit and Role/AccountStatus enums in `20261007010000_auth`. Better Auth owns password hashing, session tokens and verification/reset lifecycle. User.status is server-owned; roles are a separate compound-primary-key relation, never a user-editable Better Auth field. UserRole.grantedBy records the opaque self-actor or operational change reference. RateLimit is DB-backed for cross-instance counters. Session/Account cascade only auth credentials on actual User deletion; UserRole restricts deletion. Public account-deletion APIs are not enabled; future historical domain relations must not cascade away.

The cleanup migration drops only FoundationCheck. The original Foundation and Auth migrations remain unchanged. All three migrations applied successfully; auth/smoke were rerun after removal. See PHASE_2 for real PostgreSQL evidence and the earlier historical blockers.

The auth SQL was originally generated offline from the committed Phase 1 schema and reviewed for additive-only changes. Real application/status and the resulting auth schema were subsequently verified on disposable PostgreSQL 18.6; offline SQL comparison alone was not treated as live evidence.

Use a **disposable local/development PostgreSQL database** supplied by its operator; `.env.example` contains commented placeholders, not working credentials. Store the actual DATABASE_URL in ignored `.env.local` or process env. If the migration endpoint must be direct, set DIRECT_DATABASE_URL too. Do not use production credentials.

1. `pnpm install --frozen-lockfile`
2. `pnpm db:generate` and `pnpm db:validate`
3. `pnpm db:deploy` applies committed migrations to the selected disposable database; use `pnpm db:migrate --name <change>` only when authoring a new schema migration.
4. `pnpm db:status`
5. `pnpm db:smoke` verifies SELECT 1 plus generated-client User CRUD and rolls its row back; exit 2 means missing DATABASE_URL, exit 1 means connection/migration/config failure. No URLs/driver errors printed.

For applying reviewed committed migrations to a disposable/staging database, `pnpm db:deploy`. CI applies committed SQL only to its fresh disposable PostgreSQL service; it does not deploy the website or touch production. Never use `db push` as the committed migration workflow. `migrate dev` needs a shadow database/create-database permission (or later explicit shadow configuration); `migrate deploy` applies existing SQL without generating changes. Never run reset on user data.

Before production: rehearse migrations/backfills, assess locks, backup/restore and rollback plan. pg adapter pool applies **per app process/instance**, not global across serverless fleet. Set max instances/pool capacity against provider budget; use provider-recommended transaction pooling for app traffic/direct migration endpoint, TLS verified according to provider, regions aligned. No provisioning or PgBouncer/Redis installed now.

## Phase 3 schema and invariants

`20261007030000_profiles_companies` is additive: nine tables (Skill, WorkerProfile, WorkerSkill, WorkerPreference, WorkerWorkMode, WorkerAvailability, EmployerProfile, Company, CompanyMember), six enums, FK/index/check SQL and ten representative skills across five categories. All original migrations remain unchanged. All four migrations were applied from a fresh disposable PostgreSQL 18.6 cluster and verified with status/smoke/auth/profile/HTTP tests.

WorkerProfile/EmployerProfile each have UNIQUE userId and RESTRICT identity FKs. Services require the corresponding current role. Profile-owned skills/preferences/modes/availability cascade only with their profile. WorkerSkill has compound PK(profile,skill), references active controlled skills, and uses four proficiency levels. Seven PRODUCT employment terms and three work modes use normalized compound-PK relations. No public taxonomy-writing API exists.

Weekly availability stores weekday 0–6, integer startHour 0–23/endHour 1–24 in validated IANA timezone (default Asia/Ho_Chi_Minh). These are recurring local windows, not UTC instants. DB CHECK enforces valid ranges/start < end; an exact-window unique key and Zod prevent duplicate/overlapping same-day windows (max 14). Adjacent windows are allowed; overnight work uses two days. No calendar/minute scheduling exists. Completeness is derived on the server, with no writable score field.

Discovery defaults false in PostgreSQL and changes only through the explicit owner-authorized toggle. Composite discovery/city/id, skill/profile and preference/profile indexes support cursor queries (12 default, 30 maximum). Current role/status/opt-in conditions are queried each time. City is normalized Unicode text without digits, a narrow input aid rather than an authoritative geographic catalog or PII detector.

Company has stable UNIQUE slug, UNVERIFIED default, creator provenance and UNIQUE(creator,creationKey) for retries. CompanyMember has compound PK(company,user) and a reviewed partial unique index allowing at most one OWNER. Company + initial OWNER are atomic; public OWNER removal/transfer is unavailable, preserving the final OWNER. The DB index alone does not enforce owner existence: trusted future writers must preserve an OWNER inside the same transaction protocol. Company/member/provenance FKs restrict deletion; no public company/account deletion exists.

Sensitive writes lock/recheck User, then Company where relevant, then current membership. MANAGER removal takes the same Company lock. Creator provenance grants no authority. Real integration tests observe PostgreSQL lock waits before revocation/suspension commits, plus duplicate creation/membership, last OWNER, creator departure and pagination/privacy. Fixture-only ownership replacement under the Company lock is evidence, not a production transfer tool. Tests clean only their own profiles/companies/members/identities.

## Phase 4 schema and invariants

`20261007040000_jobs` adds three tables and JobStatus/JobCategory/CompensationType enums. EmploymentType, WorkMode, SkillLevel and Skill taxonomy are reused. Job FKs to creator User, originating EmployerProfile and optional Company all RESTRICT; these are provenance/ownership relations, never cascading history deletion. Job children also RESTRICT; term-edit services explicitly replace children inside the same transaction. No public delete endpoint exists. UNIQUE(creator,creationKey) protects retries; JobSkill has compound PK(job,skill). Job version starts at one and increments on edits/transitions.

Money is nullable BigInt min/max, exact non-negative whole VND, max 1,000,000,000,000; both bounds present or both absent, ordered min<=max, type required with amounts. Equal bounds mean fixed compensation. Currency is explicit VND; HOURLY/DAILY/PROJECT/MONTHLY are PRODUCT units. API uses canonical decimal strings, never floating-point money. Published ads require compensation; drafts can omit it. CHECKs enforce these conditions, headcount 1–1000/version positive, date ordering/range and status timestamps.

Start/end are PostgreSQL DATE, API YYYY-MM-DD, Prisma conversion UTC midnight; timestamp fields are UTC instants. Dates are optional within 2000–2100; end requires start. No date-triggered state transition exists. Weekly schedule matches WorkerAvailability: day 0–6, whole local hours, IANA zone, max 14 nonoverlapping windows, adjacent allowed, overnight split across days. DB CHECK/UNIQUE enforce ranges/exact duplicates; Zod enforces overlap and timezone. PART_TIME/TEMPORARY/SHIFT require windows to publish; other types may omit them. JobSkill required/minimumLevel uses existing four levels, max 20 unique active skills on addition/edit.

Indexes cover owner/status, company/status, status/city/type/mode/id, status/publishedAt/id, category/status/id and skill/job. Public queries currently order by immutable UUID ascending with take+1, default 12/max 30; published timestamp index leaves room for a future deliberate ordering policy. Company and personal-profile row locks serialize the count+transition, including resume. PAUSED still occupies quota. There is no in-memory mutex or counter. Real tests must prove different-actor Company concurrency, membership revocation and fresh User status under these locks.

Integration workflow also runs `pnpm test:jobs` between `test:profiles` and `test:http`. All four integration commands require explicit TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable; all five committed migrations must be applied first. Repeat deploy is expected to be a no-op. Test-only cleanup removes children/jobs before their owned Company/profile/User fixtures; production has no deletion flow. See [PHASE_4](PHASE_4.md) for execution evidence.

## Future approved constraints / deferred schemas

Company ownership survives creator departure; OWNER/MANAGER current membership. Lifetime UNIQUE(jobId,workerId); one pending Offer/Application; atomic accept+Engagement; immutable snapshots; capacity counts accepted/in-progress/completed; quota counts published/paused per owner. Reviews UNIQUE(engagementId,direction) with stable WorkerProfile/EmployerProfile/Company subject and actor provenance, sample-count aggregates rebuildable. Conversations require application or accepted invitation and current participant entitlement.

Future FKs/checks/partial indexes/lock ordering are design proposals in PHASE_0, introduced only in owning phase. Avoid naive cascading deletion of transactional/audit history; support future soft deletion/anonymization, precise legal periods D7 before production. No CV/identity/business document schemas. Outbox only Phase 7, media only avatar/logo when needed. Phase 3 resolves only required D1/D3 data/privacy decisions; scoring, D2 and remaining D3 policies stay deferred.

## Integration test convention

Use actual PostgreSQL, never SQLite. Use `pnpm test:integration` for Phase 2, `pnpm test:profiles` for Phase 3 services/constraints/lock races, and `pnpm test:http` for both phases through real Next HTTP. Configure TEST_DATABASE_URL and AUTH_TEST_DATABASE=disposable explicitly; DATABASE_URL is never silently reused. Apply committed migrations to that same disposable database first (`pnpm db:deploy`, with DATABASE_URL/DIRECT_DATABASE_URL scoped to that disposable endpoint), then `pnpm db:status`. Never point these at production. Tests generate random transient accounts/passwords and unique documentation-only IPv6 client networks, keeping production rate limits enabled. They clean up only their own users/roles/verification records and rate-limit keys; no database reset or global counter deletion. No tokens/URLs/provider bodies are printed and no real email is sent.

Verified coverage: signup/duplicate safety, verification/expired token, login/fixation, PostgreSQL session persistence across auth objects, dual roles/concurrent duplicates, ADMIN rejection, fresh suspension checks, logout invalidation, reset/expiry/reuse/session revocation, unknown-account response and persisted rate limits. The HTTP harness starts the actual Next development server on a temporary loopback port, runs the account/API flow and stops it. A test-only preload redirects Resend transport to an authenticated in-memory loopback inbox; it never changes application auth or DB behavior and is not a runtime dependency. GitHub Actions now runs these checks against a fresh PostgreSQL 18 service with disposable job-only credentials. Future business DB suites may use tests/integration; locking tests need independent real connections. Unit tests do not instantiate DB.

For Neon/cloud hosts, DATABASE_URL must use the provider's pooled endpoint for runtime traffic, DIRECT_DATABASE_URL its direct endpoint for migrations, and TEST_DATABASE_URL a separate disposable database/branch. Local disposable verification used a real local server with pg's bounded connection pool, not Neon/PgBouncer; provider TLS, transaction-pool compatibility and deployment-specific proxy configuration must still be verified when that environment is provisioned.
