import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { transientTransactionFailure } from "./failures";
import { beginObservation, endObservation } from "@/shared/observability/commit";
import { publishEvents } from "@/shared/observability/runtime";
import type { EventInput } from "@/shared/observability/contracts";

// Only DB work and volatile event intents: every retry is a NEW transaction after a confirmed abort.
// No connection-loss/unknown-commit retry, external email, or arbitrary exceptions.
export async function transaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }) {
  for (let attempt = 0; ; attempt++) {
    const events: EventInput[] = [];
    let result: T;
    try {
      result = await db.$transaction(async (tx) => {
        beginObservation(tx, events);
        try { return await work(tx); } finally { endObservation(tx); }
      }, { maxWait: 5_000, timeout: options?.timeout ?? 10_000 });
    }
    catch (error) {
      if (attempt >= 2 || !transientTransactionFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1) + Math.floor(Math.random() * 25)));
      continue;
    }
    // Outside the retry catch: a committed transaction is NEVER replayed for telemetry.
    if (events.length) await publishEvents(events);
    return result;
  }
}
