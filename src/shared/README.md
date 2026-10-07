# Shared conventions

Only cross-cutting Foundation utilities belong here. Domain rules stay in their future owning modules; do not grow a generic service framework.

Input convention for future server transports: construct an explicit Zod object per command, safeParse only expected fields, map failures to AppError VALIDATION (or curated field errors), then call the authorized service. Never spread browser input into Prisma updates or expose raw Zod issues/values. TypeScript does not validate HTTP input. Zod is selected now; no marketplace input schema exists yet.

`config/env-schema.ts` is pure for tests/CLI; `config/env.ts` is server-only. Validate a service's required environment only when that service is used; future optional integrations must not block unrelated build/UI. `db/client.ts` is lazy and server-only; never import from a Client Component. DB smoke uses the react-server condition to honor server-only without substituting a mock.

`errors/app-error.ts` maps only fixed safe messages/status/code and a trusted generated requestId. Never serialize Error objects. `logging/logger.ts` accepts only opaque IDs/static actions, outcome and duration; no arbitrary context, user text, secrets or sensitive fields. Operational logs are not the immutable business AuditLog required by later phases.
