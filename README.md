# Connecting Work

Tìm đúng việc. Gặp đúng người.

Phase 1 Foundation for a Vietnamese job marketplace. The only application screen is an honest placeholder; no authentication or marketplace features exist yet. [PRODUCT.md](PRODUCT.md) is product source of truth; [PHASE_0.md](PHASE_0.md) records approved architecture and remaining deferred decisions. Do not start Phase 2 automatically.

## Documentation

[AGENTS](AGENTS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [ROADMAP](ROADMAP.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [Phase 1 validation](PHASE_1.md)

## Local setup

Use Node 24 (tested version in `.node-version`) and pnpm 11.25.0 (`packageManager`). Install pnpm through your approved runtime/package-manager setup if missing; no second lockfile/package manager.

```text
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Open http://127.0.0.1:3000. The placeholder and build need no DB, auth secret, email, storage, analytics or monitoring service. `.env.example` documents ignored `.env.local`/process env and future categories; do not uncomment unused integrations. No real secrets are supplied. DB smoke needs your own disposable PostgreSQL DATABASE_URL and applied migrations; see [DATABASE](DATABASE.md). No SQLite or production infrastructure provisioning.

## Checks

```text
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Typecheck/build generate the Prisma client first; typecheck also runs Next typegen so a clean checkout does not require prior dev/build output. `pnpm db:smoke` reports BLOCKED (exit 2) without DATABASE_URL; it is a database integration probe, not a fake passing unit test. `pnpm db:migrate --name <change>` creates/applies development migrations; `pnpm db:deploy` only applies committed SQL to an operator-selected database. These commands do not deploy the website. Never reset shared/production data.

CI runs frozen install, schema validation, lint, typecheck, unit tests, build. No deployment or meaningless DB service without configured integration tests. PostgreSQL integration test convention is in DATABASE; full browser E2E harness is deferred until real features exist. Local preview verification evidence is recorded in PHASE_1.

## Dependencies and boundaries

Next/React render the app; TypeScript/ESLint check it (@next/eslint-plugin-next and typescript-eslint directly, avoiding incompatible eslint-config-next peers); Tailwind/PostCSS and minimal shadcn config/classes establish styles. Prisma/client/adapter-pg/pg connect PostgreSQL, server-only protects imports; Zod validates runtime env/future inputs; Vitest runs meaningful safety tests; tsx executes the TypeScript DB probe; @next/env shares Next env precedence with CLI. clsx/tailwind-merge/tw-animate-css are the minimal shadcn manual helpers. No auth/provider/domain dependencies installed.
