import { z } from "zod";
import { opaqueId } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { plainText as textSchema } from "@/shared/validation/text";

export const targets = ["JOB", "REVIEW", "USER", "MESSAGE", "COMPANY", "ENGAGEMENT"] as const;
export const reasons = ["SPAM", "SCAM", "HARASSMENT", "INAPPROPRIATE_CONTENT", "MISLEADING_JOB", "IMPERSONATION", "OTHER"] as const;
export const caseStatuses = ["OPEN", "INVESTIGATING", "ACTIONED", "CLOSED"] as const;
export const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const moderationActions = ["hide-job", "unhide-job", "hide-review", "unhide-review", "suspend", "unsuspend", "ban", "force-complete", "force-cancel"] as const;
export type ModerationAction = typeof moderationActions[number];
export type Target = typeof targets[number];
// Account IDs are opaque provider strings; all other targets use marketplace UUIDs.
export const targetIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const plainText = textSchema(2000).refine((s) => s.length > 0);
export const targetSchema = z.strictObject({ targetType: z.enum(targets), targetId: targetIdSchema })
  .refine((v) => v.targetType === "USER" || opaqueId.safeParse(v.targetId).success);
export const reportSchema = z.strictObject({ targetType: z.enum(targets), targetId: targetIdSchema,
  reasonCode: z.enum(reasons), details: plainText.nullable() })
  .refine((v) => (v.targetType === "USER" || opaqueId.safeParse(v.targetId).success) && (v.reasonCode !== "OTHER" || v.details !== null));
export const reportDetailsSchema = z.strictObject({ reasonCode: z.enum(reasons), details: plainText.nullable() })
  .refine((v) => v.reasonCode !== "OTHER" || v.details !== null);
export const reportContextSchema = z.strictObject({ applicationId: opaqueId, side: z.enum(["WORKER", "EMPLOYER"]) });
export const reasonSchema = z.strictObject({ reason: plainText, reasonCode: z.enum(reasons) });
export const createCaseSchema = reasonSchema.extend({ targetType: z.enum(targets), targetId: targetIdSchema,
  severity: z.enum(severities), reportId: opaqueId.optional() })
  .refine((v) => v.targetType === "USER" || opaqueId.safeParse(v.targetId).success);
export const actionSchema = reasonSchema.extend({ targetId: targetIdSchema });
export const attachSchema = reasonSchema.extend({ reportId: opaqueId });
export const closeSchema = reasonSchema.extend({ resolutionCode: z.enum(["RESOLVED", "DISMISSED"]) });
export const listSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: opaqueId.optional(),
  targetType: z.enum(targets).optional() });
export const casesQuerySchema = listSchema.extend({ status: z.enum(caseStatuses).optional(), severity: z.enum(severities).optional() });
export const reportsQuerySchema = listSchema.extend({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]).optional() });
export const timelineSchema = listSchema.pick({ limit: true, cursor: true });
export function actionTarget(action: ModerationAction): Target {
  return action.endsWith("job") ? "JOB" : action.endsWith("review") ? "REVIEW" : action.startsWith("force-") ? "ENGAGEMENT" : "USER";
}
export function requireBinding(type: Target, id: string, expectedType: Target, expectedId: string) {
  if (type !== expectedType || id !== expectedId) throw new AppError("CONFLICT");
}
export function accountTransition(status: string, action: "suspend" | "unsuspend" | "ban") {
  if (action === "suspend" && status === "ACTIVE") return "SUSPENDED" as const;
  if (action === "unsuspend" && status === "SUSPENDED") return "ACTIVE" as const;
  if (action === "ban" && ["ACTIVE", "SUSPENDED"].includes(status)) return "BANNED" as const;
  throw new AppError("CONFLICT");
}
export function forceTransition(status: string, action: "force-complete" | "force-cancel") {
  if (action === "force-complete" && status === "IN_PROGRESS") return "COMPLETED" as const;
  if (action === "force-cancel" && ["ACCEPTED", "IN_PROGRESS"].includes(status)) return "CANCELLED" as const;
  throw new AppError("CONFLICT");
}
export function requireOpenCase(status: string) {
  if (!["OPEN", "INVESTIGATING", "ACTIONED"].includes(status)) throw new AppError("CONFLICT");
}
