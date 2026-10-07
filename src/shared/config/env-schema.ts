import { z } from "zod";

// Importable by CLI/tests. The process.env reader is separately server-only.
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.url().refine((value) => {
    try { return ["postgresql:", "postgres:"].includes(new URL(value).protocol); }
    catch { return false; }
  }, "PostgreSQL URL required"),
});

export function parseDatabaseEnv(input: Record<string, string | undefined>) {
  const result = databaseEnvSchema.safeParse(input);
  if (!result.success) {
    // Never stringify Zod issues: they may contain sensitive input.
    throw new Error("DATABASE_URL must be configured with a valid PostgreSQL URL.");
  }
  return result.data;
}
