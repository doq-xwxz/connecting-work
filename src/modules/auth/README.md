# Identity boundary

Read PRODUCT, PHASE_0, ARCHITECTURE, SECURITY and PHASE_2 before changes. `server.ts` is the lazy server-only Better Auth entrypoint. `principal.ts` validates sessions and queries fresh User/UserRole projection; `roles.ts` owns authenticated self-activation only. `service.ts` locks/rechecks status before role upsert. `policy.ts` has explicit small checks, not generic RBAC. Current auth/status never substitutes for later ownership/company/resource-state policy.

Only WORKER/EMPLOYER may be activated. No ADMIN grant endpoint, user-update endpoint or auth admin plugin. General authentication preserves account access during SUSPENDED; new activity requires ACTIVE. BANNED denies that scoped action while detailed ban/obligation semantics remain D5. Current roles/status are never sourced from a browser field or cached cookie.

`http.ts` allowlists endpoints, bounds/strictly parses JSON, enforces exact origin and sanitizes all mutation responses. Public verification is POST confirmation; Better Auth GET verification is internal only. Client forms keep token fragments in component memory, clear history fragment and never use localStorage. Missing runtime config fails safely, not at build time. `factory.ts` supports test dependency injection but is server-only in production imports.

Integration tests use real PostgreSQL and an in-memory mail adapter only inside the operator script. No production session/email state lives in process memory. Later changes must test the real DB before claiming live auth success.
