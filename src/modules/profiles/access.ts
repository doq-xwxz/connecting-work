import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/shared/errors/app-error";

// Public scoped profile guards for services sharing an existing transaction.
export async function requireEmployerProfile(tx: Prisma.TransactionClient, actorId: string) {
  const profile = await tx.employerProfile.findUnique({ where: { userId: actorId }, select: { id: true } });
  if (!profile) throw new AppError("FORBIDDEN");
  return profile;
}
export async function requireWorkerProfile(tx: Prisma.TransactionClient, actorId: string) {
  const profile = await tx.workerProfile.findUnique({ where: { userId: actorId }, select: { id: true } });
  if (!profile) throw new AppError("NOT_FOUND");
  return profile;
}
