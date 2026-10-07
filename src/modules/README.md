# Domain boundary

Only the Phase 2 auth/authorization module exists. No marketplace business modules exist. See [ARCHITECTURE](../../ARCHITECTURE.md) and [PHASE_0](../../PHASE_0.md).

Create each domain only in its authorized phase. Its public service/query API owns policies, DTOs and transactions; other modules must not import its repositories. UI and transports are not authorization boundaries. Never populate this directory with placeholder implementations.
