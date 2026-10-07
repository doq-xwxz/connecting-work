import "server-only";
import { parseDatabaseEnv } from "./env-schema";

export function getDatabaseEnv() {
  return parseDatabaseEnv({ DATABASE_URL: process.env.DATABASE_URL });
}
