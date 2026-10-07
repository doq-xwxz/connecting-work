import { describe, expect, it } from "vitest";
import { parseDatabaseEnv } from "./env-schema";

describe("database environment", () => {
  it("accepts PostgreSQL and strips unrelated secrets", () => {
    const url = "postgresql://localhost:5432/disposable_test";
    expect(parseDatabaseEnv({ DATABASE_URL: url, AUTH_SECRET: "private" })).toEqual({ DATABASE_URL: url });
  });
  it.each([undefined, "", "sqlite:local.db", "https://example.com", "sensitive-invalid-value"])("rejects missing/non-PostgreSQL URL without echoing it", (DATABASE_URL) => {
    expect(() => parseDatabaseEnv({ DATABASE_URL })).toThrow("DATABASE_URL must be configured with a valid PostgreSQL URL.");
  });
});
