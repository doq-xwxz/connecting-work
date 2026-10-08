# Phase 7 — Messaging + Notifications

Review evidence, 2026-10-08. Phases 0–6 are approved; PRODUCT, approved historical reports/migrations and lockfile remain unchanged. Implemented scope ends at Phase 7, with no Phase 8 or deployment. Local execution and remote publication evidence are distinguished below.

## 1. Phase 7 Summary

Implemented Application-context Conversation, immutable plain-text Message, current participant entitlement, Company authorship/access, UserBlock, active-work continuity, client polling, bounded history, monotonic per-user read/unread and transactional coalesced in-app NEW_MESSAGE notifications. All persistence/authorization/limits/locks are PostgreSQL backed.

## 2. D6 decisions resolved

Application-first lazy explicit-POST chat; no arbitrary DM or invitation endpoint. Accepted-invitation semantics remain deferred, as explicitly permitted for this phase; pending invitation never grants chat. Pre-engagement active pipeline can communicate, terminal Application/Engagement becomes history-only. Block does not mutate hiring; current Company participants form the employer contact context. Polling/read/coalescing decisions are minimal V1, not a broader outreach/contact/retention policy.

## 3. Conversation model / entitlement

Mandatory unique applicationId, jobId, workerProfileId, created/updated/lastMessage times; composite FK binds the exact Application/Job/Worker, unique Worker×Job prevents duplicates. Exactly one source exists: Application. Lazy creation locks the context and DB uniqueness handles retries/races; GET never creates a conversation. Neither Offer revisions nor Engagements create another chat. Discoverability is irrelevant after Application entitlement.

## 4. Message model

Internal actual senderUserId, server-derived WORKER/EMPLOYER side, body, createdAt and creationKey. Unique conversation/sender/key; identical normalized replay returns the same Message, changed body conflicts, authorization is rechecked before replay. SQL trigger freezes Message updates; no ordinary edit/delete API. DTO includes only id, body, side, safe display, own flag and ISO time. Names derive from current identity, while actual author identity persists internally.

## 5. Application / Engagement chat behavior

APPLIED/VIEWED/SHORTLISTED/OFFERED permits chat subject to account/block; PAUSED/CLOSED preserves this existing context, including pending Offers. REJECTED/WITHDRAWN/CANCELLED without active work is read-only. ACCEPTED requires active Engagement. ACCEPTED/IN_PROGRESS work preserves scoped chat across CLOSED, discovery opt-out, block and actor suspension; policy also preserves a trusted valid active obligation under a CANCELLED Job, while the ordinary Phase 5 cancel API still forbids that state. COMPLETED/CANCELLED Engagement is history-only even without block. No hiring state changes are caused by chat/block.

## 6. Blocking

Directional UserBlock pair, unique and DB self-block denial. Block/unblock derives the target from an opposite-side message in an authorized conversation, never an arbitrary User input/directory. Either-direction block denies pre-work sends and keeps history. For Company, any Worker↔CURRENT OWNER/MANAGER block denies that Company's pre-work contact, preventing recruiter-switch bypass; departed member blocks persist but cease affecting this context. Active work overrides contact block only for that relationship; full block/read-only applies after work ends. Full graph is not exposed.

## 7. Account status / obligation exceptions

Fresh relevant role/current scope on every operation; no ADMIN bypass or role-removal exception. SUSPENDED can read existing entitled history and create/send only for existing active work; cannot initiate pre-engagement recruiting chat. BANNED actors cannot chat read/send; banned personal counterpart/Worker denies sends. Detailed banned/Company moderation exceptions stay D5 and fail closed. Own account access/authentication policy is unchanged.

## 8. Polling architecture

Visible client page polls every8 seconds, aborts on cleanup, no overlapping polling and no server background loop. Server resolves before/after UUIDs within the authorized conversation and orders by createdAt/id. Default30/max50 pages; older and forward endpoints coexist. UI dedupes by ID, retains max200 recent messages, displays one bounded older page and pauses polling during history browsing. Return to recent resumes polling. Forward position advances through polls, not send responses, preventing concurrent incoming-message skips. Message timestamp is database UTC clock or prior conversation time+1ms under its lock, avoiding same-millisecond UUID insertion behind a cursor.

## 9. Read/unread state

ConversationReadState PK conversation/user with composite lastReadMessage FK. Mark-read uses a server-owned message position, never browser time, and compares timestamp/id monotonically. Old/concurrent tabs cannot regress. Sender's own messages are excluded; a colleague manager's message is unread for another manager until personally read. Current-user totals are explicit inbox-only scoped SQL: materialize authorized conversation IDs then indexed per-conversation ranges, not a global navigation scan. No per-message seen receipts or Redis.

## 10. Notification foundation

NEW_MESSAGE only, direct personal recipient/Worker; no sender notification. One unread conversation/recipient Notification, protected by a partial unique index, updates lastMessageId until read. Atomic send includes Message + lastMessageAt + Notification. No JSON payload/full body/contact/email/token/Offer data is copied; display and safe internal href derive from allowlisted current context. Owner/current role/context rechecked on list/read. An old read target cannot clear a coalesced notification for newer messages. Marking notification read also advances that conversation's own read marker.

## 11. Outbox decision

Deferred: no asynchronous external side effect exists. Direct same-transaction in-app writes provide durability without daemon, drain endpoint, cron or false email delivery guarantee. Hiring-event notifications, email delivery/preferences and future outbox/dispatcher remain deferred, not implemented silently.

## 12. Company messaging access

Any current authorized OWNER/MANAGER with current EMPLOYER/profile can access; historical creator/recruiter loses access on departure. Messages retain actual author. Read markers are per User, not Company-wide. Worker→Company uses each current manager's unread inbox instead of N-member durable fan-out; Company→Worker creates one direct notification. No membership management expansion/transfer exists.

## 13. Privacy / security

Strict Zod method/path/query/body allowlists, real sessions, current role/status/ownership, UUID scoping, exact-origin writes, JSON16KiB, no-store/no-referrer and safe errors remain. Sender/side/contact/status injection, conversation/message/notification IDOR and unrelated DM fail safely. Body1 meaningful–4000 UTF-16 characters, normalize CRLF/CR→LF, reject invisible-only/control/ill-formed Unicode. React escaped/plain text; no raw HTML/Markdown/embeds/uploads/search. User-entered contact text is not automatically scanned or released. No sensitive payload/SQL/token logging.

Lock order: actor User NO KEY UPDATE→namespaced Worker-contact PG transaction advisory lock→Company/personal EmployerProfile→Job→Application→Conversation. Shared currentActor uses NO KEY UPDATE too, preserving status/role exclusion while allowing recipient User FK KEY SHARE without two-way-send/hiring deadlocks. No second User/Profile exclusive lock; membership and hiring writers retain their canonical Company/Job locks. Trusted User-plus-owner writers must use the same key-compatible mode. Existing User-only FOR UPDATE suspension/grant tests remain valid. Review covered SQL bindings, FK consistency, DTOs, scope, read/send/block races, replay/rates and client/server imports.

## 14. Routes/UI

`/worker/messages`, `/employer/messages`, their `/[conversationId]` details, `/notifications`; Application/Engagement context links through “Mở tin nhắn”. No discovery/recommendation message button. Explicit marketplace API POST side-applications/:id/conversation; GET side-conversations/list/detail/messages; POST messages/read/block; GET notifications and POST notification/:id/read. Bodies: send body/creationKey, read messageId, block messageId/blocked. UI has labeled composer, busy controls, live feedback, history navigation and disabled-state explanation. Browser interaction automation is not claimed by server-rendered HTTP tests.

## 15. Database migration/indexes

Additive `20261008070000_messaging`, five tables/two enums, RESTRICT history FKs, composite source/message/read/notification consistency, unique entitlement/idempotency/block/read state, text/self-block CHECKs, immutable Message trigger and one-unread-notification partial index. Message conversation/time/id, Worker/Job conversations, user read state, reverse blocks and user/read/time notification indexes inspected in real PostgreSQL. Earlier SQL-owned FTS remains intact.

Fresh all-eight migration chain PASS; separate upgrade DB built with seven historical migrations, baselined then populated with representative pre-7 User/profile/Job/Application. Deploy applied only new migration, old Job FTS/Application nullable match metadata preserved and no unnecessary Conversation/Message created. Status current and repeat deploy no-op PASS. No db push/reset/production URL or historical SQL rewrite.

## 16. Rate limits / abuse controls

Existing DB RateLimit with messaging-only opaque namespaces, fixed60-second windows:30 messages/User/Conversation,60/User global. Actor lock serializes buckets across conversations. Authorized same-key/body replay consumes no budget/duplicate notification; different-key repeated bodies consume normal rate. Text/JSON/page bounds add flood protection. No client-only rate security, in-memory mutex, ML, auto-ban or moderation expansion. Retention/pruning and broader release abuse operations remain later work.

## 17. Tests

Executed locally on Node24.20.0/pnpm11.25.0 and disposable PostgreSQL18.6, with real Next/Better Auth/DB and only test email transport intercepted:

| Check | Status / evidence |
|---|---|
| install | PASS — frozen lockfile, no dependencies changed |
| Prisma validate | PASS — schema valid |
| lint | PASS — zero warnings/errors |
| typecheck | PASS — generated Prisma/Next types and strict TS |
| unit | PASS — 338 tests/14 files, including35 Phase7 cases |
| build | PASS — production compilation/dynamic messaging routes, no runtime credentials needed |
| migration deploy/status | PASS — fresh8, existing-data upgrade, current status, repeat no-op |
| db smoke | PASS — transient User CRUD rolled back |
| Phase 2 regression | PASS — actual PostgreSQL auth/verification/reset/session/roles/status/limits |
| Phase 3 regression | PASS — profiles/privacy/current Company scope and real revocation/suspension waits |
| Phase 4 regression | PASS — ownership/quota/lifecycle/constraints/concurrency |
| Phase 5 regression | PASS — immutable hiring/capacity/expiry/obligations/cleanup/material restrictions |
| Phase 6 regression | PASS — FTS/Unicode/filters/cursors/200-pool/DTO/immutable apply facts |
| Phase 7 PostgreSQL integration | PASS — entitlement/current roles/membership/departure/status, terminal history, blocks, notifications, bounds, constraints, persistent rates |
| HTTP tests | PASS — retained Phase2–6 plus Phase7 API/pages/XSS/origin/oversize/IDOR/poll/history/read/block/notification/suspended active work/manager removal |
| concurrency/idempotency | PASS — simultaneous lazy open, same-key duplicate/changed body, both-direction send, monotonic concurrent reads/read-send notification race, observed real User/Company/advisory lock waits, timestamp ties/cross-context cursors |
| GitHub Actions | BLOCKED — not yet published/verified at this local report stage; replaced with exact remote evidence after publication |

Known pg8.23.1 concurrent-client-query deprecation warning persists from the adapter/earlier phases; assertions pass, no dependency upgrade/suppressed failure. Earlier development failures were corrected and rerun: advisory-lock VOID projection needed a text cast, Company unread expectation needed to include another manager's message, and a new assertion callback required async. No runtime secret/SQL/payload was printed. These checks are not production load/penetration/browser-interaction testing.

## 18. Deployment compatibility

CONFIRMED: production remains independent of developer PC. Managed Node/Next, injected env/origin/secrets, PostgreSQL18 UTF8 and existing configured auth mail provider; no production local file/inbox/worker/daemon/scheduler/Redis/WebSocket. Notifications commit durably with Message and need no post-commit worker. Cloud TLS/pooling/proxy/region/backups/mail/release setup remains separately provisioned operational verification. No deployment occurred.

## 19. Files changed

Schema + one new migration; messaging contracts/policies/projections/services/server pages/client chat/tests; hiring public chat query and context link; five app route wrappers, marketplace adapter/navigation/no-referrer header; shared actor lock mode; real messaging PostgreSQL suite/extended HTTP cleanup; package test command/CI; AGENTS/ARCHITECTURE/DATABASE/SECURITY/ROADMAP/README/this report. No package version/lockfile or PRODUCT/Phase0–6 report/migration change. Generated client/build/env/test data/binaries are ignored and excluded.

## 20. Deviations / unresolved decisions

Application-only source and direct transactional in-app delivery are expressly allowed simplifications. Accepted invitation, hiring-event/email notifications/preferences, asynchronous outbox, contact-sharing policy, D5 banned/moderation, D7 retention and Phase8 formulas remain deferred. Company block context and per-user colleague unread behavior are explicit minimal decisions. No arbitrary DM, reviews/moderation/uploads/payments/AI/deployment added. No original approved choice was reopened.

## 21. Remaining blockers

No known local Phase7 implementation/validation blocker. Exact remote publication and both CI jobs remain to be verified before handoff. Production operations/deployment and future features are outside scope, not fabricated PASS outcomes. Disposable PostgreSQL and HTTP children stop after checks; temporary binaries/cluster/credentials will be removed after final verification. Stop at Phase7 review.

## 22. Git commit / remote CI evidence

Base main: `04031c47dfa1455934aa10bd50b097f0459188c4`. Standing user authorization covers ordinary commit/push to main after staged review, without force/rewrite. Remote exact SHA and checks/postgres-auth results are pending publication and will be recorded only after reading completed GitHub Actions evidence. Secret-pattern/ignored-path/historical-file/dependency/diff/SQL/security review precedes staging; no credentials/generated/env/build/test data are eligible.
