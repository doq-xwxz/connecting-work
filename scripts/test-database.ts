import { parseDatabaseEnv } from "../src/shared/config/env-schema";

// Explicit opt-in AND test-designated database name, independent of hostname.
// Never fall back to DATABASE_URL or accept destructive tests in production mode.
export function testDatabase(env: Record<string, string | undefined>) {
  if (env.AUTH_TEST_DATABASE !== "disposable" || !env.TEST_DATABASE_URL || env.NODE_ENV === "production") throw new Error("Disposable test database configuration required.");
  const { DATABASE_URL } = parseDatabaseEnv({ DATABASE_URL: env.TEST_DATABASE_URL });
  let name: string;
  try { name = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1)); } catch { throw new Error("Invalid test database configuration."); }
  if (!/(^|[_-])(test|disposable)([_-]|$)/i.test(name)) throw new Error("Database must have an explicit test/disposable name.");
  return { DATABASE_URL };
}
