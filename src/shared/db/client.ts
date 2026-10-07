import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseEnv } from "@/shared/config/env";

const globalForDb = globalThis as unknown as { foundationDb?: PrismaClient };
let productionDb: PrismaClient | undefined;

export function getDb(): PrismaClient {
  const cached = process.env.NODE_ENV === "production" ? productionDb : globalForDb.foundationDb;
  if (cached) return cached;

  const { DATABASE_URL } = getDatabaseEnv();
  const adapter = new PrismaPg({
    connectionString: DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const client = new PrismaClient({ adapter });
  if (process.env.NODE_ENV === "production") productionDb = client;
  else globalForDb.foundationDb = client;
  return client;
}
