# Connecting Work

Tìm đúng việc. Gặp đúng người.

Phase 3 profile and company foundation for a Vietnamese job marketplace. Verified email/password accounts and dual Worker/Employer roles support separate profiles, controlled skills, weekly availability, opt-in private employer discovery and Company OWNER/MANAGER authorization. Jobs and hiring are not implemented. [PRODUCT.md](PRODUCT.md) remains product source of truth; [PHASE_0.md](PHASE_0.md) records approved architecture and deferred decisions. Phases 0–2 are approved and Phase 2 is closed. Stop after Phase 3 review; Phase 4 and deployment are not authorized.

## Documentation

[AGENTS](AGENTS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [ROADMAP](ROADMAP.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [Phase 1 historical report](PHASE_1.md) · [Phase 2 evidence](PHASE_2.md) · [Phase 3 review](PHASE_3.md)

## Local setup

Use Node 24 (tested version in `.node-version`) and pnpm 11.25.0 (`packageManager`). Install pnpm through your approved runtime/package-manager setup if missing; no second lockfile/package manager.

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Open http://127.0.0.1:3000. Public pages/build need no runtime credentials. For working auth, configure ignored .env.local or hosting env: DATABASE_URL, APP_URL, BETTER_AUTH_SECRET, EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM. BETTER_AUTH_URL is optional and must match APP_URL if supplied; DIRECT_DATABASE_URL optionally selects an unpooled migration endpoint. Apply committed migrations before using auth. No real secrets are supplied. Missing auth/provider config fails safely when used. No SQLite or infrastructure provisioning. See [DATABASE](DATABASE.md) and [SECURITY](SECURITY.md).

Routes: /sign-up, /sign-in, /verify-email, /forgot-password, /reset-password and protected /account. Verify email before sign-in; choose one/both normal roles on account after login. ADMIN is trusted operational provisioning only, never a form option. Verification/reset mail links use fragments and POST confirmation; do not copy tokens into logs/issues. For manual local tests, use a sender and recipient controlled by the operator. Automated tests use a fake email provider, never real email.

Staging/production: set an explicit HTTPS APP_URL, a random secret of at least 32 characters, managed PostgreSQL with verified TLS/provider pooling, and configured email sender. Preview branches need their own explicit origin, isolated database and secrets; no automatic trust of arbitrary Vercel hosts. Managed hosts inject env. pnpm start respects managed PORT/binding defaults; only pnpm dev intentionally binds loopback. No identity/session data lives on the operator's filesystem or in process memory. On Vercel use the Node runtime, align DB region and verify trusted proxy IP/rate-limit behavior. Email work uses Next after, which the managed Next host must support. No deployment occurs here.

## Checks

After login and role activation, use `/worker/profile` (also `/edit`) for your WorkerProfile and discoverability toggle, `/employer/profile` (also `/edit`) for your personal EmployerProfile, `/employer/workers` for private discovery, and `/employer/companies`, `/new`, `/[companySlug]` for current company membership. Create an EmployerProfile before discovery/company creation. Worker discoverability defaults off. OWNER can inspect members/remove MANAGER; MANAGER can edit company details. No member-add/invitation/ownership-transfer, upload or company-verification action exists.

```text
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Typecheck/build generate the Prisma client first; typecheck also runs Next typegen so a clean checkout does not require prior dev/build output. `pnpm db:smoke` reports BLOCKED (exit 2) without DATABASE_URL; it is a database integration probe, not a fake passing unit test. `pnpm db:migrate --name <change>` creates/applies development migrations; `pnpm db:deploy` only applies committed SQL to an operator-selected database. These commands do not deploy the website. Never reset shared/production data.

CI runs frozen install, schema validation, lint, typecheck, unit tests and build, plus a fresh PostgreSQL 18 service for all committed migrations, DB smoke, `pnpm test:integration` (Phase 2 auth), `pnpm test:profiles` (Phase 3 services/constraints/real lock races), and `pnpm test:http` (actual Next auth and profile/company HTTP). All three integration commands require explicit TEST_DATABASE_URL, AUTH_TEST_DATABASE=disposable and applied migrations on that dedicated PostgreSQL DB. Scope DATABASE_URL/DIRECT_DATABASE_URL to the same disposable endpoint for migration/smoke commands; never use production. Tests clean up only their own fixtures. The HTTP child starts/stops automatically and intercepts only email transport. No browser E2E dependency, deployment or production/provider secret was added. See PHASE_3 for current evidence; PHASE_2 remains the approved historical report.

## Dependencies and boundaries

Next/React render the app; TypeScript/ESLint check it (@next/eslint-plugin-next and typescript-eslint directly); Tailwind/PostCSS and minimal shadcn config/classes establish styles. Prisma/client/adapter-pg/pg connect PostgreSQL; server-only protects imports; Zod validates explicit boundaries; Vitest runs safety tests; tsx runs DB/auth probes; @next/env shares env precedence. Better Auth 1.7.7 and @better-auth/prisma-adapter 1.7.7 add auth only. Resend adapter uses native fetch without another SDK dependency. No social login, business provider or marketplace domain dependency is installed.
