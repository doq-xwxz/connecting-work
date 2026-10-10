import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { transientTransactionFailure } from "./failures";

// Only DB-only callbacks: every retry is a NEW transaction after a confirmed abort.
// No connection-loss/unknown-commit retry, external email, or arbitrary exceptions.
export async function transaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }) {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { maxWait: 5_000, timeout: options?.timeout ?? 10_000 }); }
    catch (error) {
      if (attempt >= 2 || !transientTransactionFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1) + Math.floor(Math.random() * 25)));
    }
  }
}
