# Domain boundary

Auth, profiles, companies and Phase 4 jobs modules exist. Public services/contracts own domain policy and transactions. Companies/jobs import only the transaction-scoped profile prerequisite; jobs calls the Company membership public service, never another module's repository. Auth owns fresh principal/status/role checks and shared User-row locking. Jobs adds owner-row quota and Job locks; pure terms/policy/DTO modules contain no runtime DB import. UI leaves receive allowlisted contracts only. No hiring module or Application/Offer/Engagement tables exist. See [ARCHITECTURE](../../ARCHITECTURE.md), [PHASE_0](../../PHASE_0.md) and [PHASE_4](../../PHASE_4.md).

Create each domain only in its authorized phase. Its public service/query API owns policies, DTOs and transactions; other modules must not import its repositories. UI and transports are not authorization boundaries. Never populate this directory with placeholder implementations.
