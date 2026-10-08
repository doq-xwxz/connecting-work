import { AppError } from "@/shared/errors/app-error";
import { completeness, levels, type WorkerInput } from "@/modules/profiles/contracts";
import type { JobInput } from "@/modules/jobs/contracts";
import type { ApplicationStatus, EngagementStatus, OfferStatus } from "@/generated/prisma/client";
import type { ApplicationAction, EngagementAction } from "./contracts";

export const occupiedStatuses = ["ACCEPTED", "IN_PROGRESS", "COMPLETED"] satisfies EngagementStatus[];
export const activeStatuses = ["ACCEPTED", "IN_PROGRESS"] satisfies EngagementStatus[];
export const preAcceptance = ["APPLIED", "VIEWED", "SHORTLISTED", "OFFERED"] satisfies ApplicationStatus[];
export function expired(expiresAt: Date | null, now: Date) { return expiresAt !== null && now >= expiresAt; }
export function requireCapacity(occupied: number, headcount: number) { if (occupied >= headcount) throw new AppError("CONFLICT"); }
export function requireEligibility(name: string, worker: WorkerInput, job: JobInput) {
  if (!name.trim() || !completeness(worker).complete || (["PART_TIME", "TEMPORARY", "SHIFT"].includes(job.employmentType ?? "") && !worker.availability.length)) throw new AppError("FORBIDDEN");
  if (job.skills.some((skill) => skill.required && !worker.skills.some((owned) => owned.skillId === skill.skillId && levels.indexOf(owned.level) >= levels.indexOf(skill.minimumLevel)))) throw new AppError("FORBIDDEN");
}
export function applicationTransition(status: ApplicationStatus, action: ApplicationAction, hasEngagement: boolean, hasPending: boolean): ApplicationStatus {
  if (hasEngagement) throw new AppError("CONFLICT");
  if (action === "view" && ["APPLIED", "VIEWED"].includes(status)) return "VIEWED";
  if (action === "shortlist" && ["APPLIED", "VIEWED", "SHORTLISTED"].includes(status)) return "SHORTLISTED";
  if (action === "reject" && preAcceptance.includes(status as typeof preAcceptance[number]) && !hasPending) return "REJECTED";
  if (action === "withdraw" && preAcceptance.includes(status as typeof preAcceptance[number])) return "WITHDRAWN";
  if ((action === "reject" && status === "REJECTED") || (action === "withdraw" && status === "WITHDRAWN")) return status;
  throw new AppError("CONFLICT");
}
export function requirePending(status: OfferStatus) { if (status !== "PENDING") throw new AppError("CONFLICT"); }
export function engagementTransition(status: EngagementStatus, action: EngagementAction, completionRequested: boolean): EngagementStatus {
  if (action === "start" && ["ACCEPTED", "IN_PROGRESS"].includes(status)) return "IN_PROGRESS";
  if (action === "request-completion" && status === "IN_PROGRESS") return status;
  if (action === "confirm-completion" && ((status === "IN_PROGRESS" && completionRequested) || status === "COMPLETED")) return "COMPLETED";
  if (action === "cancel" && [...activeStatuses, "CANCELLED"].includes(status)) return "CANCELLED";
  throw new AppError("CONFLICT");
}
