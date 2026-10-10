# Phase 12 — Production Readiness + Public Deployment

## 1. Phase 12 Summary

**BLOCKED — USER ACTION REQUIRED** for public production release. Phases 0–11 are approved. The 2026-10-10 request authorizes Phase 12 and project-specific managed deployment, excludes paid purchases without approval, and requires honest provider blockers while repository preparation proceeds. Base main: f588201d493b8eb74ba330317902128ef9f7044b. No Phase 13.

Review covers PRODUCT, PHASE_0–11, AGENTS, ARCHITECTURE, DATABASE, SECURITY, ROADMAP, README, env example, CI, Prisma config and all ten migration SQL files. Approved product/history/schema/SQL remain intact. Repository work: controlled Vercel config, private indexing policy, read-only release DB check, narrowly patched transitive mysql2, operational runbook and current docs. Implemented source is distinct from actual public evidence below.

## 2. Production architecture

Intended user-owned Vercel Next.js/Node24 + managed PostgreSQL18 UTF8 + Resend. Optional analytics/error providers remain Noop; domain SQL owns KPIs. No Redis/R2/cron/WebSocket/PC service needed. No actual provider project, region or plan chosen. Vercel connector listed team promote/promte1; the user explicitly confirmed it is not theirs. No resource writes were made there. Integration listing returned403; no authenticated local Vercel CLI/link exists. Do not deploy to that account context.

## 3. Production environment

Names only: DATABASE_URL, APP_URL, BETTER_AUTH_SECRET, EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM; optional BETTER_AUTH_URL, ENABLE_HSTS, NEXT_TELEMETRY_DISABLED. Hosting build: ENABLE_EXPERIMENTAL_COREPACK. Controlled release runner only: DIRECT_DATABASE_URL. Managed runtime: NODE_ENV. No production secret generated/stored or env pulled. No public analytics keys, test flags or mail preload in production. Details and scoping in PRODUCTION_RUNBOOK.

## 4. Managed PostgreSQL

BLOCKED: no user-owned managed database/access/region/plan. PG18 UTF8/collation required by unchanged search migration. Neon is a candidate documented to support PG18; actual provider account/connection is unverified. Pooled runtime/direct migration, verified TLS, connection/instance budgets and role grants must be checked against the chosen provider. New db:release-check validates SQL migration checksums, compatibility, ten taxonomy skills and required index/history guards using READ ONLY; it is not a TLS/backup certification.

## 5. Backup / restore

Managed backup/PITR capability/window/owner and restore drill: BLOCKED, unconfigured. Runbook includes a nonproduction provider restore drill, restricted verification, reconciliation/switch procedure and no plaintext local backup. Published provider plan features do not prove a backup exists. Local PostgreSQL18.6 custom-format pg_dump → empty separate disposable DB → pg_restore --exit-on-error passed; restored migration status, all ten checksums/reference/index/history checks and rollback-only CRUD passed. This local rehearsal is not provider backup/PITR evidence; task-local backup and credentials are excluded from Git.

## 6. Production migrations

NOT RUN / BLOCKED. Ten historical SQL files unchanged. Separate controlled direct-connection pnpm db:deploy → db:status → db:release-check only after green exact-SHA CI, compatibility, backup/repair review. No reset/db push/dev migration, no migration in build/start. Runbook documents chain, failed/partial migration stop and independently reviewed forward repair. No production fixture suite or smoke seed.

## 7. Hosting deployment

BLOCKED: correct user account is not connected. vercel.json declares Next, frozen Corepack/pnpm install, pnpm build and private source/log settings; automatic Git deployments disabled until isolated previews/release gates exist. Node24 engines and pnpm11.25 remain pinned. No deployment ID/URL/deployed SHA/time exists. No payment or domain purchase.

## 8. HTTPS / domain / security headers

Public HTTPS/proxy/TLS/CDN/cookies/HSTS: BLOCKED pending real deployment. Existing CSP excludes production eval but explicitly allows Next inline bootstrap; HSTS remains build-time opt-in after stable HTTPS review. Added X-Robots-Tag:noindex,nofollow to private/API/auth paths and robots disallow policy. Public Jobs stay indexable. This is crawling policy, not authorization. Actual production-mode local smoke tests the changed responses; public-host verification remains separate.

## 9. Authentication / email verification

Real Resend sender/domain SPF/DKIM, inbox receipt, HTTPS verification/reset, production sessions and intended ADMIN identity: BLOCKED. No sender/recipient/domain was supplied and no key requested in chat. Runbook preserves normal verified signup, fragment/POST tokens, current authorization and reviewed direct ADMIN provisioning under User lock; no bootstrap API or hardcoded admin. No real mail sent.

## 10. Core marketplace public smoke

BLOCKED: no public app/managed DB/real verified identities. Runbook specifies distinct controlled Worker/Employer, profile/discovery-off, marked Job publish, anonymous FTS/safe detail, advisory matching, apply/shortlist/immutable Offer/accept, contextual chat/poll/read, organic start/request/confirm, bilateral reviews and owner close without deleting history. Disposable local/CI flows are regression evidence only.

## 11. Moderation / Admin / Analytics smoke

Public smoke BLOCKED. Runbook limits report/case/hide/unhide/audit to dedicated smoke resources, forbids real-user sanctions, separates forced work if tested, and verifies fresh ADMIN aggregate UTC metrics from SQL. No fake mature liquidity cohort/backdating or provider-event KPI. No actual production ADMIN granted.

## 12. Health / readiness

Public probes BLOCKED, no URL. Existing health has no provider dependency; ready checks PostgreSQL only and returns safe503 on failure. Actual production-mode disposable regression verifies healthy/unreachable DB, no-store/minimal payloads. Optional providers do not gate readiness.

## 13. Monitoring / analytics providers

Noop production defaults, no external SDK/configured export. Sentry/PostHog deferred pending real credentials plus reviewed identity/region/retention/privacy. Hosted uptime, actual runtime/DB alerts and routing are unconfigured/BLOCKED. Runbook covers hosted health/readiness and INTERNAL/error/deploy/migration/DB/mail investigation without invented SLO thresholds or PC watchdog.

## 14. Security / dependency audit

Initial audit3 high/1 moderate/0 critical. Narrow explicit mysql2 override3.15.3→3.23.1 (same major, Prisma transitive exact-pin exception) removes both MySQL advisories; no MySQL path is enabled. Post-patch audit **FAIL:2 high/0 moderate/0 critical**, exit1. deepmerge-ts7.1.5 cyclic-object issue is Prisma config tooling with major8 fix; braces3.0.3 dev glob issue has no reported patch. Neither is an identified reachable marketplace request path; that is a source-review inference, not proof of remediation. No broad major upgrade/override. Full direct pins unchanged; lock diff is mysql subtree/replacement sql-escaper/removal old queue/escaping packages and peer context. Current SECURITY section supersedes its historical audit counts.

## 15. Backup / rollback / incident runbook

PRODUCTION_RUNBOOK.md covers account/region/env/least privilege, release order, exact SHA, direct migrations/failure, backups/restore/reconciliation, first-release absence of prior good build, forward-compatible provider rollback, real-mail/ADMIN/public smoke, PC independence, managed incidents/rotation and D4/D7 inventory/legal/retention ownership. Procedures are authored; actual provider restore/rollback/alerts are not claimed executed. Phone remains optional/no SMS and Company badge optional under Phase12 request; no document/AI/payment expansion.

## 16. PC independence

Architecture stores durable runtime state in managed PostgreSQL/env and needs no PC background worker. **Operational public PC-independence confirmation BLOCKED** until a real hosted app/DB is probed after stopping task-local processes. Never substitute the local disposable PostgreSQL test cluster for production or shut down unrelated user apps.

## 17. CI / regression

Local checks executed on Node24.20/pnpm11.25: frozen install PASS, Prisma validate PASS, lint PASS, typecheck PASS, unit435/20 PASS, build PASS, peer check PASS. Release-check without direct env correctly reports BLOCKED/exit2 with no connection detail. Fresh disposable PostgreSQL18.6: ten migrations deploy/status/release-check PASS, repeated deploy no-op PASS, rollback-only smoke PASS. All twelve suites PASS: integration/auth, profiles, jobs, hiring, matching, messaging, reviews, moderation (including populated upgrade), hardening, analytics, HTTP and actual next start production smoke. Restored separate disposable DB also passed status/release-check/smoke. Secret/artifact scan covered 228 Git-eligible files and20 public JS chunks: no task password/provider secrets/private keys/DB URL or PrismaClient in public chunks; no public source maps. Historical product/phase/schema/migrations unchanged; diff whitespace check PASS. Exact GitHub Actions receipt is recorded after publication. CI adds read-only release verification after migration status; no production secret/deploy step. Audit remains FAIL as above.

## 18. Files changed

Publication receipt (2026-10-10 UTC): implementation commit c1417a03a71f13208d8759fb8d27f9d729bc0939 pushed normally to main; git ls-remote matched exactly. [Repository checks run38061432265](https://github.com/doq-xwxz/connecting-work/actions/runs/38061432265) completed SUCCESS: both checks and postgres-auth, every step successful with none skipped, including release-check, analytics, HTTP, build and production smoke. This receipt documents that implementation SHA; a later documentation-only receipt commit is verified separately in the final response. Task-owned local PostgreSQL was stopped and its binaries/data/backup/credential files removed after validation. No public deployment occurred.

vercel.json; next.config.ts; src/app/robots.ts; scripts/production-db-check.ts; scripts/production-smoke.ts; package.json; pnpm-workspace.yaml/pnpm-lock.yaml; .env.example; .github/workflows/ci.yml; AGENTS/ARCHITECTURE/DATABASE/SECURITY/ROADMAP/README; PRODUCTION_RUNBOOK.md and this report. No PRODUCT/PHASE_0–11/Prisma schema/historical SQL change. Credentials/env/generated clients/builds/local binaries/test data excluded from publication.

## 19. Public production evidence

URL: unavailable. Deployed SHA/deployment ID/time: unavailable. Public health/readiness, real mail/auth/marketplace/admin/backup/restore: BLOCKED. GitHub source publication and green disposable CI do not count as public production evidence.

## 20. User actions still required

1. Connect the user's actual personal Vercel account and authorize GitHub repo access; confirm project ownership. The currently connected team is explicitly unrelated.
2. Provide/provision a user-owned PG18 UTF8 managed database in an approved region/free plan where suitable, direct/pooled secret configuration, actual connection/backup/PITR capabilities and restore ownership. Any paid requirement needs separate approval.
3. Configure an owned verified Resend sender/domain/DNS and server Secret; identify controlled recipients for real verification/reset. Do not paste credentials or token links in chat.
4. Identify intended verified ADMIN plus reviewed operator/change reference; assign incident/privacy/restore owners and review jurisdiction/data region/retention/notice/export/deletion process. Unresolved legal duties remain a launch blocker.
5. Once access is correct, complete controlled migration/deploy/public smoke/backup-restore/alerts/PC-off evidence and exact final deployed SHA acceptance. Existing Phase12 authorization covers those actions within the stated boundaries.

## 21. Remaining production risks

No real cloud TLS/pooling/proxy/Next after/mail/CDN/load/restore/rollback/monitor routing evidence. Correct account access and D7 operations/legal policy unresolved. Two outstanding dependency highs, inline-bootstrap CSP allowance, first200 candidate ranking/live cursor behavior, small-sample reputation, lossy telemetry and known nonfatal pg overlapping-query deprecation remain disclosed. No production SLA/accessibility/penetration or legal compliance certification.

## 22. Final roadmap status

Phases0–11 approved. Phase12 repository preparation implemented and validation/publication tracked below; public release BLOCKED. No Phase13/post-MVP work.
