# Phase 3 — Worker / Employer Profiles + Company Foundation

Status: implemented and verified locally and on GitHub Actions; awaiting Phase 3 review. Phases 0–2 are approved and Phase 2 is closed. PRODUCT, PHASE_0, PHASE_1 and PHASE_2 remain unchanged. No Phase 4 or deployment is authorized.

## 1. Phase 3 Summary

Implemented separate WorkerProfile and personal EmployerProfile, controlled skills, normalized work preferences/modes, weekly hourly availability, deterministic completeness, explicit private discovery opt-in and Company OWNER/MANAGER foundation. Existing email/password/session/role flows remain intact. All runtime state stays in PostgreSQL; no upload, background service, cloud provisioning or deployment was introduced.

Implemented means code/migration/UI exists. Verified means an actual named check ran successfully. BLOCKED means required evidence could not be obtained; deferred means deliberately outside this phase. GitHub evidence is finalized after publication in §18.

## 2. Phase 3 decisions resolved

Only the required D1/D3 subset is resolved:

- D1 taxonomy: ten controlled skills, two per initial category (Admin/Operations, Finance/Accounting, Marketing, Creative, General Part-time); free text category is operational taxonomy metadata, with active flag and unique slug. Four levels: BEGINNER, INTERMEDIATE, ADVANCED, EXPERT. No yearsExperience field needed.
- D1 preferences: all seven PRODUCT terms FULL_TIME, PART_TIME, TEMPORARY, FREELANCE, PROJECT, SHIFT, INTERNSHIP; multiple choices stored in WorkerPreference. ON_SITE, REMOTE, HYBRID use WorkerWorkMode. No job terms or compensation fields.
- D1 availability: recurring weekday 0–6 and whole-hour start/end windows, max 14, no overlaps, validated IANA timezone default Asia/Ho_Chi_Minh. Overnight work uses separate day windows. No calendar integration/start-date field needed.
- D1 completeness: equal weight required checks only; headline, city or explicit REMOTE, work preference (employment choice + location mode), at least one active skill; availability additionally required for PART_TIME/TEMPORARY/SHIFT. Percentage is the rounded fraction of satisfied applicable checks. No Match Score.
- D3 privacy: discoverable defaults false in DB; separate explicit owner opt-in. Discovery requires ACTIVE authenticated EMPLOYER + EmployerProfile, no ADMIN bypass; target must be current ACTIVE WORKER + discoverable. Incomplete opted-in drafts are permitted; completeness is informational until a later apply flow exists.
- D3 projection: name/headline, city/remote modes, employment preferences, skill names/levels and AVAILABILITY_PROVIDED or NOT_SPECIFIED. This says only whether weekly windows were supplied, not present availability/free time. No raw schedule/timezone/contact/status/bio/auth data.

Matching/ranking, contact release, exact job location and unrelated D2/D4–D9 choices remain deferred. Approved architecture/product choices were not reopened.

## 3. Database models and migrations

Added nine tables: Skill, WorkerProfile, WorkerSkill, WorkerPreference, WorkerWorkMode, WorkerAvailability, EmployerProfile, Company, CompanyMember; six bounded enums. `20261007030000_profiles_companies` is additive and includes ten taxonomy seeds. The original three migrations are intact.

UNIQUE profile userIds, skill slug, company slug, company creator/creationKey; compound PK WorkerSkill/profile+skill, preferences/modes and CompanyMember/company+user; availability range CHECK/exact-window uniqueness; partial unique company OWNER index. FK deletion is RESTRICT for identity/company/provenance and skill references; profile-owned details alone cascade. No account/company deletion endpoint. Future hiring-history FKs must not cascade history away.

All four migrations applied from a fresh disposable PostgreSQL 18.6 cluster. Repeated deploy is no-op; status up to date and rollback-only User smoke passed. No db push, reset, SQLite or production URL was used. Custom partial index/CHECK are maintained explicitly in SQL and must be retained by future migration authors. DB allows at most one OWNER; initial/remaining OWNER existence is enforced by atomic services and rejecting public OWNER removal, not claimed as a standalone DB guarantee.

## 4. WorkerProfile

At most one per User, explicit creation after current WORKER role. Name comes from User; email/phone are not duplicated. Own create/edit/read only, UUID profile ID never substitutes for session ownership. Drafts may be incomplete. Fields: headline, coarse city, optional PRODUCT summary, timezone, controlled skill levels, normalized preferences/modes and weekly windows. Separate discoverability toggle; no CV/document/avatar upload or contact sharing.

## 5. Skills and availability

Selected skills must exist and be active; duplicate skill IDs/choices, invalid levels/timezones/windows, excessive input and unknown fields are rejected. Taxonomy has no public mutation surface. Weekly windows are local civil schedule plus timezone, not falsely converted into UTC instants; application timestamps remain standard Prisma UTC Date values. Adjacent windows allowed; overlapping same-day windows rejected. Detailed windows appear only in the self DTO and internal matching foundation, never employer discovery.

## 6. Profile completeness

Server computes `{complete, percentage, missingFields}` on reads and saves. Four checks normally, five for the availability-required types. Empty required values fail; explicit REMOTE substitutes for city. Optional bio, website or other cosmetic data never add points. No client percentage/completeness field accepted or stored. This does not authorize apply/publish or implement matching.

## 7. Worker privacy/discoverability

New profile is hidden. Owner consciously opts in; disabling remains permitted when SUSPENDED/BANNED. Opt-out is read from PostgreSQL each discovery request without detached index/shared cache. Default cursor page is 12, maximum 30, ordered opaque profile UUID; city/skill/preference filters are strict and bounded. Discovery checks fresh actor and target role/status. No public directory/detail endpoint exists.

Discovery fields: id (profile only), displayName, headline, city, preferences, workModes, skill name/level, coarse availability indicator. Excludes userId, email, phone, precise address/GPS, bio, schedule/timezone, status, memberships, sessions/accounts/verification. User-authored names/headlines are not automatically PII-redacted. City is coarse normalized text with digits rejected, not a certified geographic/PII catalog. No precise-address field exists.

## 8. EmployerProfile

At most one per current EMPLOYER User, independently coexisting with WorkerProfile. Personal employer type (INDIVIDUAL/SHOP/STARTUP/SME/COMPANY/AGENCY), optional PRODUCT description and coarse city; display name derives from identity. Owner-scoped self DTO, safe 404 for editing a different profile. It does not confer Company membership. EmployerProfile is explicitly required for discovery and Company activity.

## 9. Company / CompanyMember

Company is a stable entity with name, description, coarse city, optional HTTP(S) website, stable server slug, UNVERIFIED default and timestamps. Website is never fetched. Verification is not a posting prerequisite and no user/admin verification action exists here.

Creation requires ACTIVE EMPLOYER + EmployerProfile, locks/rechecks User and creates Company + OWNER atomically. A required client-generated UUID creationKey supports repeated requests for the same intended creation; same creator/key and matching current data returns the same company after membership recheck. Different input conflicts; departed creator cannot use the key to regain authority. Slugs normalize Vietnamese text, use a random 64-bit suffix, UNIQUE index and up to three whole-transaction collision retries. Slug is routing, never authorization.

OWNER and MANAGER can edit details. Only OWNER can read member roster/remove MANAGER. Final OWNER removal is rejected; MANAGER cannot grant OWNER or self-add. Current membership, not createdByUserId, grants access. No public member-add/invitation/promote/transfer API; these are explicitly deferred instead of granting membership from unverified email. Trusted test provisioning/ownership replacement is confined to disposable tests and proves departure semantics; it is not a production feature.

## 10. Authorization policies

Real Better Auth session → fresh User/role/status → profile/membership/resource scope → field-projected DTO. Shared server-only currentActor supports transactional checks. Sensitive writes lock/re-read User first, then Company if relevant, then current membership. Member removal uses the same Company lock. Future role/status/moderation/membership writers must follow this protocol. No cached/browser/creator authority.

ACTIVE can create/edit subject to policy. SUSPENDED/BANNED fail closed for new activity, including edits and discovery activation; own reads and hiding profile remain allowed. No active Engagement exceptions are invented. Out-of-scope private resources return 404; lack of role/owner-only capability returns 403; final OWNER/duplicate creation returns 409. No generic enterprise RBAC or ADMIN bypass.

## 11. Routes/UI

Existing design tokens, simple labeled forms and feedback, both persona links from account. Dynamic Node routes:

| UI | Function |
|---|---|
| /worker/profile, /worker/profile/edit | Own profile, skills/preferences/windows/completeness and privacy toggle |
| /employer/profile, /employer/profile/edit | Personal employer setup/edit |
| /employer/workers | Private filtered cursor discovery |
| /employer/companies | Current membership cursor list |
| /employer/companies/new | Atomic Company/OWNER creation |
| /employer/companies/[companySlug] | Membership-checked details/edit; OWNER roster/removal |

Explicit API prefix `/api/marketplace`:

| Method/path | Service |
|---|---|
| GET/POST worker; PUT worker/:id | Own worker read/create/edit |
| PATCH worker/:id/discoverability | Separate owner opt-in/out |
| GET skills | Controlled taxonomy for current WORKER |
| GET/POST employer; PUT employer/:id | Own employer read/create/edit |
| GET workers | Employer-profile-required private discovery |
| GET/POST companies | Current company list / atomic creation |
| GET companies/:slug; PUT company/:id | Current-member read / edit |
| GET company/:id/members; DELETE company/:id/members/:memberId | OWNER roster / MANAGER removal |

All unknown method/path combinations denied. Mutation JSON max 16 KiB and exact Origin; strict schemas/query allowlists reject mass assignment, duplicate/unknown query keys and unsafe cursor/size. API safe errors expose static category/message/requestId plus allowlisted field names/static validation messages only, never raw Zod issues/input. Private routes are no-store, profile/company pages no-referrer. UI disabled controls are not authorization.

## 12. Tests

Local Windows Node 24.20 / pnpm 11.25.0; actual disposable PostgreSQL 18.6. No production database or real email used.

| Check | Result / evidence |
|---|---|
| pnpm install --frozen-lockfile | PASS; unchanged dependencies/lockfile |
| pnpm lint | PASS; zero warnings |
| pnpm typecheck | PASS; Prisma generation + Next typegen + strict TS |
| pnpm test | PASS; 10 files, 115 tests (68 retained Phase 2/foundation + 47 Phase 3) |
| pnpm build | PASS; public build without runtime credentials, dynamic private routes |
| pnpm db:validate | PASS |
| pnpm db:deploy / db:status | PASS; four migrations, up to date |
| pnpm db:smoke | PASS; transient User rolled back |
| pnpm test:integration | PASS; Phase 2 auth/verification/reset/sessions/roles/suspension/rate-limit regression |
| pnpm test:profiles | PASS; real PostgreSQL constraints/duplicate concurrency/privacy/authorization/Company locks |
| pnpm test:http | PASS; real Next Phase 2 regression + Phase 3 APIs/server pages |
| Secret/diff/migration review | PASS; Git-eligible sources/static assets scanned; SQL/new/tracked files reviewed; original reports/migrations/lockfile unchanged |
| GitHub Actions | PASS; implementation run 37649738484, checks + postgres-auth, exact commit in §18 |

Unit coverage: required completeness/availability, levels, preference/location rules, overlap/bounds/timezone, safe field errors, protected input, DTO/coarse projection, slug/role/website and pagination. Pure DTO tests mock only the server-only import marker, never DB/concurrency behavior.

PostgreSQL coverage: concurrent unique Worker/Employer creation; own/other profile boundaries; active taxonomy and DB uniqueness/range checks; dual roles; opt-in/withdrawal, EmployerProfile/WORKER-only/ADMIN denials, coarse DTO and cursor separation; atomic Company+OWNER and same-key retries; duplicate memberships/second OWNER; MANAGER capabilities, last OWNER, verification/OWNER injection; real blocked Company mutation then membership revocation; real blocked User mutation then suspension; SUSPENDED/BANNED denial/privacy opt-out; departed creator denied management/retry while Company persists. Race tests observe pg_stat_activity lock waits on independent connections before holder commits.

HTTP coverage: actual verified signup/login cookie/session, all Phase 2 reset/logout/revocation flows retained; unauthenticated private APIs denied, EmployerProfile prerequisite/current role removal, own create/update/conflict, other-ID/mass-assignment denial, filtered opt-in discovery fields/withdrawal, bounded page sizes, Company replay/details/edit, roster/final OWNER, unsupported member-add, forged verification and cross-Origin denied; suspended profile/company/discovery denied while hiding allowed. All suggested server pages render via real Next. This is HTTP/server-render testing, not a claim of browser-interaction/accessibility or production-host testing. Email-only development preload remains test-confined; app/auth/DB are real.

CI extends existing checks with pnpm test:profiles in the PostgreSQL job and the expanded pnpm test:http. It retains frozen install, Prisma, lint/types/unit/build and all Phase 2 integration checks. No deployment step added.

## 13. Security review

Reviewed server/client import boundary, DTO projections, profile IDOR, current roles/status/membership, User→Company lock ordering, OWNER protection, creation replay, slug/website/input handling, origin/JSON limits, cursor bounds and safe errors. No input/profile/contact/token logging added. Secret scan PASS: all Git-eligible files checked for private keys/provider/GitHub token patterns and actual disposable DB URL/password; built static assets checked for those actual credentials. Ignored credential/client/build paths confirmed. This is a targeted scan, not a guarantee against every possible secret format. Historical approved files/migrations and dependency lockfile remain intact. Staged review/publication evidence in §18.

No new Phase 3 runtime dependency or provider. Remaining production CSP/abuse thresholds/proxy/TLS/backup/legal operations remain approved future work; no full marketplace penetration-test claim.

## 14. Deployment compatibility

CONFIRMED: implementation can later run on the public Internet independently of the developer PC. Dynamic Node Next hosting (Vercel or equivalent), env-provided APP_URL/secrets/mail and PostgreSQL hold all runtime state. No local file persistence, uploads, PC service, production localhost fallback or detached local worker. Existing managed-host after behavior handles auth mail. Test-only PostgreSQL binaries/cluster/credentials live only in ignored temporary paths and are removed after validation. No deployment performed.

Provider TLS/pooling, hosted email delivery, trusted proxy/rate-limit behavior and operational release configuration must be verified when a managed environment is explicitly provisioned. Local/CI success does not claim those checks.

## 15. Files changed

Schema + one migration; new auth transaction guard; profiles contracts/services/prerequisites/DTOs/unit tests/forms/server presentation; company contracts/services/policies/unit tests/forms; explicit marketplace API and worker/employer route wrappers; account/home navigation/copy; Next private headers; PostgreSQL Phase 3 suite; expanded HTTP suite; package script and CI; AGENTS, ARCHITECTURE, DATABASE, SECURITY, ROADMAP, README, module boundary note and this report. No dependency version/lockfile, PRODUCT or approved historical phase-report change.

## 16. Deviations / unresolved decisions

No product contradiction found. Invitation/member-add/promotion/ownership-transfer are explicitly deferred as permitted; public final OWNER removal is impossible. Avatar/logo upload not required. No yearsExperience/start-date field, taxonomy admin UI, full FTS, ranking or matching needed. Company coarse DTO is defined but only authorized membership views are exposed. Optional summary/type choices use PRODUCT profile concepts without adding hiring scope. All unrelated deferred decisions remain in PHASE_0.

## 17. Remaining blockers

No Phase 3 implementation/validation/publication blocker remains. Real disposable DB locks and actual HTTP passed locally and remotely. Phase 3 user review remains pending. Hosted-provider/release checks are deferred deployment readiness, not evidence of a deployment. Stop here; no Jobs/hiring/messaging/uploads/moderation/Phase 4 or deployment.

## 18. Git commit / remote CI evidence

Base: eb445038f1dad3083d6f2424c46715f3ca5a0e7a on main. Published implementation: [845be9377b2b4f3289105155b779a05498f51b57](https://github.com/doq-xwxz/connecting-work/commit/845be9377b2b4f3289105155b779a05498f51b57). git ls-remote verified that exact SHA on origin/main immediately after push. No force push/history rewrite.

[GitHub Actions implementation run 37649738484](https://github.com/doq-xwxz/connecting-work/actions/runs/37649738484): completed SUCCESS on that exact SHA; both checks and postgres-auth SUCCESS. The PostgreSQL job includes migrations/status/smoke, Phase 2 auth integration, Phase 3 real lock integration and the combined real Next HTTP suite. Independent Ubuntu/PostgreSQL CI passed in addition to Windows/PostgreSQL local checks.

Staged review covered 41 authorized source/schema/migration/test/doc files, 1,580 insertions/38 deletions, with git diff --cached --check PASS. No credentials, local env, generated clients/build output, disposable test data or unrelated changes staged. Original PRODUCT/PHASE_0/PHASE_1/PHASE_2, original migrations and lockfile unchanged. Disposable local cluster/binaries/credentials were stopped and removed after verification. This documentation-only follow-up records the verified implementation evidence; its own commit/CI are identifiable in repository history and the delivery response.
