import { z } from "zod";
import { AppError } from "@/shared/errors/app-error";

export type Side = "WORKER" | "EMPLOYER";
export const bodySchema = z.string().max(4000).transform((s) => s.replace(/\r\n?/g, "\n"))
  .refine((s) => s.isWellFormed() && /[^\p{White_Space}\p{Cf}]/u.test(s) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(s));
export const sendSchema = z.strictObject({ body: bodySchema, creationKey: z.uuid() });
export const readSchema = z.strictObject({ messageId: z.uuid() });
export const blockSchema = z.strictObject({ messageId: z.uuid(), blocked: z.boolean() });
export const pageSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(30), cursor: z.uuid().optional() });
export const messagesSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(30), before: z.uuid().optional(), after: z.uuid().optional() })
  .refine((q) => !(q.before && q.after));

export type Position = { id: string; createdAt: Date };
export function newer(a: Position, b: Position) {
  return a.createdAt.getTime() > b.createdAt.getTime() || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id);
}
export function requireSameBody(previous: string, body: string) {
  if (previous !== body) throw new AppError("CONFLICT");
}
export function chatPolicy(input: { actorStatus: string; counterpartyBanned: boolean; application: string; engagement: string | null; job: string; blocked: boolean }) {
  if (input.actorStatus === "BANNED" || input.counterpartyBanned) return "ACCOUNT_RESTRICTED";
  const active = input.engagement === "ACCEPTED" || input.engagement === "IN_PROGRESS";
  if (active) return null;
  if (input.actorStatus !== "ACTIVE") return "ACCOUNT_RESTRICTED";
  if (input.blocked) return "BLOCKED";
  if (input.engagement || ["REJECTED", "WITHDRAWN", "CANCELLED", "ACCEPTED"].includes(input.application) || ["DRAFT", "COMPLETED", "CANCELLED"].includes(input.job)) return "RELATIONSHIP_ENDED";
  return null;
}
