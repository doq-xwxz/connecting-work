import { AppError } from "@/shared/errors/app-error";
import type { JobAction, JobInput, JobStatus, JobTerms } from "./contracts";
import { FREE_ACTIVE_LIMIT } from "./contracts";

export function isActive(status: JobStatus) { return status === "PUBLISHED" || status === "PAUSED"; }
export function nextStatus(status: JobStatus, action: JobAction): JobStatus {
  if (action === "publish" && status === "DRAFT") return "PUBLISHED";
  if (action === "resume" && status === "PAUSED") return "PUBLISHED";
  if (action === "pause" && status === "PUBLISHED") return "PAUSED";
  if (action === "close" && isActive(status)) return "CLOSED";
  if (action === "cancel" && (status === "DRAFT" || isActive(status))) return "CANCELLED";
  throw new AppError("CONFLICT");
}
export function permitsRestrictedActor(action: JobAction) { return ["pause", "close", "cancel"].includes(action); }
export function requireQuota(count: number, currentStatus: JobStatus) {
  if (count + (isActive(currentStatus) ? 0 : 1) > FREE_ACTIVE_LIMIT) throw new AppError("CONFLICT");
}
export function ownsJob(actorEmployerProfileId: string, job: { employerProfileId: string; companyId: string | null }, hasCurrentMembership: boolean) {
  return job.companyId ? hasCurrentMembership : job.employerProfileId === actorEmployerProfileId;
}
export function publishValidation(input: JobInput, allSkillsActive = true) {
  const checks = { title: Boolean(input.title.trim()), description: Boolean(input.description.trim()), category: Boolean(input.category),
    employmentType: Boolean(input.employmentType), workMode: Boolean(input.workMode),
    location: input.workMode === "REMOTE" || Boolean(input.city),
    compensation: Boolean(input.compensationType && input.compensationMin !== null && input.compensationMax !== null),
    headcount: input.headcount >= 1 && input.headcount <= 1000,
    skills: input.skills.length > 0 && allSkillsActive,
    schedule: !["PART_TIME", "TEMPORARY", "SHIFT"].includes(input.employmentType ?? "") || input.schedule.length > 0 };
  const missingFields = Object.entries(checks).filter(([, valid]) => !valid).map(([field]) => field);
  return { valid: missingFields.length === 0, missingFields };
}
export function requirePublishable(input: JobInput, allSkillsActive = true) {
  if (!publishValidation(input, allSkillsActive).valid) throw new AppError("VALIDATION");
}
export function jobTerms(input: JobInput): JobTerms {
  return { schemaVersion: 1, title: input.title, description: input.description, category: input.category,
    employmentType: input.employmentType, workMode: input.workMode, city: input.city || null, compensationType: input.compensationType,
    compensationMin: input.compensationMin, compensationMax: input.compensationMax, currency: input.currency,
    headcount: input.headcount, startDate: input.startDate, endDate: input.endDate, timezone: input.timezone,
    skills: input.skills.map(({ skillId, required, minimumLevel }) => ({ skillId, required, minimumLevel })),
    schedule: input.schedule.map(({ weekday, startHour, endHour }) => ({ weekday, startHour, endHour })) };
}
export function duplicateTerms(input: JobInput): JobInput {
  const { schemaVersion: _schemaVersion, ...terms } = jobTerms(input);
  void _schemaVersion;
  return terms;
}
const canonical = (value: unknown): string => JSON.stringify(value);
export function classifyJobEdit(before: JobInput, after: JobInput) {
  const left = jobTerms(before), right = jobTerms(after);
  // Sort set-like fields before comparison so reordering is not a material change.
  left.skills.sort((a, b) => a.skillId.localeCompare(b.skillId)); right.skills.sort((a, b) => a.skillId.localeCompare(b.skillId));
  const order = (a: JobInput["schedule"][number], b: JobInput["schedule"][number]) => a.weekday - b.weekday || a.startHour - b.startHour || a.endHour - b.endHour;
  left.schedule.sort(order); right.schedule.sort(order);
  const changedFields = (Object.keys(left) as (keyof JobTerms)[]).filter((field) => canonical(left[field]) !== canonical(right[field]));
  return { material: changedFields.filter((field) => field !== "description"), nonMaterial: changedFields.filter((field) => field === "description") };
}
export type HiringEditContext = { phase: "PRE_HIRING" } | { phase: "HIRING"; hasApplications: boolean; occupiedSlots: number };
export function requireEditableTerms(before: JobInput, after: JobInput, context: HiringEditContext) {
  if (context.phase === "PRE_HIRING") return; // No Application/Engagement model/count exists yet.
  if (after.headcount < context.occupiedSlots || (context.hasApplications && classifyJobEdit(before, after).material.length)) throw new AppError("CONFLICT");
}
