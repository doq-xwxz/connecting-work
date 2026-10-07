# Domain boundary

Phase 2 auth/authorization and Phase 3 profiles/companies modules exist. Profiles and companies expose public services/contracts; companies imports only the transaction-scoped profile prerequisite, never a repository. Auth owns fresh principal/status/role checks and the shared User-row lock protocol. UI leaves import safe contracts only. No Jobs/hiring module exists. See [ARCHITECTURE](../../ARCHITECTURE.md) and [PHASE_0](../../PHASE_0.md).

Create each domain only in its authorized phase. Its public service/query API owns policies, DTOs and transactions; other modules must not import its repositories. UI and transports are not authorization boundaries. Never populate this directory with placeholder implementations.
