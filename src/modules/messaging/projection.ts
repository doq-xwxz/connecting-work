import type { MessageSide } from "@/generated/prisma/client";
export function messageDto(row: { id: string; body: string; senderSide: MessageSide; senderUserId: string; createdAt: Date; sender: { name: string } }, actorId: string) {
  return { id: row.id, body: row.body, senderSide: row.senderSide, senderDisplay: row.sender.name, own: row.senderUserId === actorId, createdAt: row.createdAt.toISOString() };
}
export function notificationDto(row: { id: string; type: "NEW_MESSAGE"; readAt: Date | null; createdAt: Date; lastMessageId: string;
  conversation: { id: string; job: { title: string }; worker: { userId: string } } }, actorId: string) {
  return { id: row.id, type: row.type, jobTitle: row.conversation.job.title, read: row.readAt !== null, createdAt: row.createdAt.toISOString(), messageId: row.lastMessageId,
    href: `/${row.conversation.worker.userId === actorId ? "worker" : "employer"}/messages/${row.conversation.id}` };
}
