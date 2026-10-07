# Phase 1 — Foundation implementation report

Implementation date: 2026-10-07, Windows / PowerShell. Source of truth: [PRODUCT](PRODUCT.md); approved planning: [PHASE_0](PHASE_0.md). Foundation code and local checks are ready for review. Live PostgreSQL verification remains BLOCKED. Phase 2 has not started.

## 1. Environment and versions

Initial checkout contained only untracked PRODUCT.md and PHASE_0.md, no application and no Git commits. Branch: main. Origin fetch/push: https://github.com/doq-xwxz/connecting-work.git. Git author name/email were not configured. Neither source document was edited. No commit, push, deployment or production provisioning was performed.

Node 24.20.0; pnpm 11.25.0 exclusively. npm 11.19.0 was available but was not used as the project package manager. Node is pinned in .node-version and constrained to major 24; packageManager pins pnpm. All 25 direct package versions are exact; pnpm-lock.yaml records transitive versions.

| Package(s) | Version | Purpose |
|---|---|---|
| next, @next/env, @next/eslint-plugin-next | 16.4.0 | App Router; CLI environment loading; official Next lint rules |
| react, react-dom | 19.3.0 | Rendering |
| typescript | 6.0.3 | Strict static checking, compatible with selected lint parser |
| eslint / typescript-eslint | 10.12.0 / 8.71.1 | Flat lint configuration and TypeScript rules/parser |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | CSS utility compilation |
| prisma, @prisma/client, @prisma/adapter-pg | 7.10.0 | Stable Prisma CLI/generated client/PostgreSQL adapter |
| pg / @types/pg | 8.23.1 | PostgreSQL driver and typings |
| zod | 4.6.5 | Runtime boundary validation |
| vitest / tsx | 5.0.3 / 4.23.15 | Unit runner / TypeScript smoke script execution |
| server-only | 0.0.1 | Prevent client imports of server entrypoints |
| clsx / tailwind-merge / tw-animate-css | 2.1.1 / 3.7.0 / 1.4.0 | Minimal manual shadcn helpers/styles |
| @types/node | 24.19.1 | Runtime typings aligned with Node 24 |
| @types/react, @types/react-dom | 19.3.0 | React typings |

## 2. Files created and preserved

43 new Foundation files; existing PRODUCT.md and PHASE_0.md preserved. Paths below are relative to this repository.

- Governance/report: AGENTS.md, ARCHITECTURE.md, DATABASE.md, SECURITY.md, ROADMAP.md, DESIGN_SYSTEM.md, README.md, PHASE_1.md.
- Tooling/configuration: package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .npmrc, .node-version, .gitignore, .env.example, next.config.ts, tsconfig.json, eslint.config.mjs, postcss.config.mjs, components.json, vitest.config.ts, .github/workflows/ci.yml.
- Database: prisma.config.ts, prisma/schema.prisma, prisma/migrations/migration_lock.toml, prisma/migrations/20261007000000_foundation/migration.sql, scripts/db-smoke.ts.
- App: src/app/layout.tsx, src/app/page.tsx, src/app/globals.css.
- Boundaries: src/components/ui/README.md, src/modules/README.md, src/shared/README.md.
- Shared utilities/tests: src/shared/config/env-schema.ts, env-schema.test.ts, env.ts; src/shared/db/client.ts; src/shared/errors/app-error.ts, app-error.test.ts; src/shared/logging/logger-core.ts, logger.ts, logger.test.ts; src/shared/ui/utils.ts.

Generated Prisma client, next-env.d.ts, build output, node_modules and caches are ignored, reproducible outputs.

## 3. Repository architecture

Minimal modular monolith: app is transport/presentation; components/ui holds only the manual shadcn boundary; modules documents future domain boundaries without business scaffolds; shared holds cross-cutting config, DB, errors, logging and UI utility. The sole screen is a Vietnamese, server-rendered Foundation placeholder that states marketplace functions are unavailable.

DB/env/logger entrypoints use server-only. DB initialization is lazy, cached across local HMR and bounded to five connections per process. One infrastructure-only FoundationCheck table supports a migration and real transactional smoke without encoding any marketplace schema. Zod env errors and seven application error categories return safe messages. Structured logging projects only explicit fields; callers must use static actions and opaque IDs. No auth or domain API exists. D1–D9 remain deferred except the Foundation runtime/package selection portion of D8.

## 4. Dependency rationale

The version table gives every direct dependency's purpose. Non-obvious choices: Prisma 7 uses adapter-pg plus pg for PostgreSQL; @next/env ensures operator scripts use Next env precedence; server-only enforces framework import boundaries; tsx runs the DB probe without a separate script compilation pipeline. Vitest tests safety behavior without a DB. clsx/tailwind-merge/tw-animate-css establish the documented manual shadcn convention without installing unused components, icons or a CLI dependency. Official Next lint plugin and typescript-eslint are configured directly to avoid incompatible peers in eslint-config-next. Type packages support strict checks. No Better Auth, email, storage, analytics, monitoring, Redis, search, AI or business dependencies were added. Final peer check reports no issues.

## 5. Commands and verification

These are final local results after fixes, not claims that every initial attempt passed.

| Command/check | Status | Evidence |
|---|---|---|
| pnpm install --frozen-lockfile --fetch-timeout=600000 | PASS | Lockfile accepted; supply-chain policies passed, 462 entries checked |
| pnpm peers check | PASS | No peer dependency issues |
| pnpm db:validate | PASS | Prisma schema valid; does not prove connectivity |
| pnpm lint | PASS | Zero warnings/errors |
| pnpm typecheck | PASS | Prisma generation, Next typegen and strict tsc completed |
| pnpm test | PASS | 3 files, 17 tests: env rejection/stripping, error mapping/non-disclosure, log field projection |
| pnpm build | PASS | Production compile/types/static rendering; / and /_not-found generated |
| pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script | PASS | Offline SQL agrees with baseline migration; no DB contacted |
| pnpm db:smoke | BLOCKED | DATABASE_URL absent; script reports BLOCKED and sets exit code 2 |
| Migration application/status on PostgreSQL | BLOCKED | No configured disposable PostgreSQL endpoint; no migration applied |
| pnpm dev + browser inspection | PASS | Placeholder visually inspected, Vietnamese semantic content, GET / 200; captured warn/error log list empty |
| pnpm start + local HTTP | PASS | Production HTTP 200; nosniff, DENY frame and strict-origin-when-cross-origin headers present; no powered-by header |
| Production browser recheck | BLOCKED | In-app browser reported connection refusal and URL-policy rejection of its generated error page; production HTTP succeeded independently |

CI is configured for frozen install, schema validation, lint, typecheck, tests and build with read-only repository permissions and no deploy. A remote GitHub Actions run has not occurred. No fake PostgreSQL CI service or E2E suite was added. Future real PostgreSQL integration conventions and migration commands are in DATABASE.md.

Earlier failures resolved: registry timeout via longer install timeout; incompatible TypeScript/ESLint peers via compatible stable versions/direct plugin configuration; Vitest server-only import via pure logger formatter plus guarded production wrapper; ESM @next/env interop via default import; stale dependency auto-installs via verifyDepsBeforeRun=error and a final frozen install. These do not remain failing checks.

## 6. Security checks

Source review confirms strict TypeScript, server-only DB/env entrypoints, no Client Components importing DB, no frontend authorization assumptions, no wildcard CORS, and no public secret variables. UI/build need no secret. Actual .env.local/.env.production, generated client and build artifacts are ignored; .env.example remains eligible for Git. No real secrets were created. Token/private-key pattern scan found no matches; dummy safety-test values and commented URL placeholders are intentional. This is a bounded source scan, not a credential audit of all future dependencies.

Error tests verify internal causes/SQL/stack and unknown error messages do not reach DTOs. Logger test verifies arbitrary password/token/email/body/context keys are dropped. Operator code suppresses connection details. Logs still require safe identifiers, as documented. HTTP headers were checked on the production response. pnpm allows only required Prisma/esbuild build scripts and exact Next release-age exceptions; stale dependencies fail rather than silently installing during checks.

## 7. Deviations and implementation choices

No product requirement or approved business rule was changed. Manual scaffolding preserved the two existing source documents. Selected stable Prisma 7.10.0 instead of registry's Prisma 8 release candidate. TypeScript 6.0.3 was selected instead of an incompatible newer major. Direct official Next lint rules replace eslint-config-next because its bundled plugin peers were incompatible with ESLint 10; this does not claim parity with every React/hooks/accessibility rule in that preset. Future interactive UI should add suitable compatible lint coverage when needed.

shadcn is initialized manually with config/tokens/helpers and no unused primitives. Full E2E harness, provider provisioning and business integration tests are deferred under the user's scope. Next automatic agent-rule generation is disabled so AGENTS.md remains deliberately maintained. FoundationCheck is an explained infrastructure probe, not a domain model. No SQLite substitution was used.

## 8. Remaining Phase 1 issues

To close live DB evidence, the operator must provide DATABASE_URL for an explicitly disposable PostgreSQL database (and DIRECT_DATABASE_URL if migrations need a direct endpoint), apply the committed migration, run db:status and db:smoke. DATABASE.md gives the commands and shadow-database requirements for migrate dev. Missing email/auth/storage/analytics settings are intentional and do not block Foundation.

Production browser recheck remains limited by the in-app browser connection/error-page policy; dev visual verification and production HTTP verification passed separately. No attempt was made to bypass that policy. The local preview process was stopped after verification. Remote CI, Git commit/push and deployment have not been performed. Review is required before starting Phase 2.

## 9. Git diff review

This repository has no HEAD commit; all 45 eligible files appear untracked, including the two pre-existing source documents. Ordinary git diff is therefore empty and is not evidence of no changes. Reviewed the new file contents, package manifest/lock importer, dependency scope, schema versus generated migration SQL, security boundaries and ignore rules; also checked each new file with git diff --no-index --check. PRODUCT.md remains 21,355 bytes and PHASE_0.md remains 60,030 bytes. New Foundation scope: 43 files, no deletions or modifications to those source documents. Origin remains connected to the user's GitHub repository. Nothing has been published.
