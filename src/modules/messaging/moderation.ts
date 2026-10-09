import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { lockChatApplication } from "@/modules/hiring/chat-query";
import { AppError } from "@/shared/errors/app-error";

export async function authorizeReportedMessage(tx: Prisma.TransactionClient, actor: Principal, id: string) {
  const row = await tx.message.findUnique({ where: { id }, select: { conversation: { select: { applicationId: true, worker: { select: { userId: true } } } } } });
  if (!row) throw new AppError("NOT_FOUND");
  const side = row.conversation.worker.userId === actor.id ? "WORKER" : "EMPLOYER";
  if (!actor.roles.includes(side)) throw new AppError("NOT_FOUND");
  const context = await lockChatApplication(tx, actor, side, row.conversation.applicationId);
  if (actor.status === "SUSPENDED" && !["ACCEPTED", "IN_PROGRESS"].includes(context.engagement?.status ?? "")) throw new AppError("FORBIDDEN");
}
// Exceptional investigation loads just the reported message, never arbitrary history.
export async function moderationMessageContext(tx: Prisma.TransactionClient, id: string) {
  return tx.message.findUnique({ where: { id }, select: { id: true, body: true, senderSide: true, createdAt: true } });
}
