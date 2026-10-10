import { plainText } from "@/shared/validation/text";
import { z } from "zod";
import { AppError } from "@/shared/errors/app-error";

export const levels = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"] as const;
export const preferences = ["FULL_TIME", "PART_TIME", "TEMPORARY", "FREELANCE", "PROJECT", "SHIFT", "INTERNSHIP"] as const;
export const workModes = ["ON_SITE", "REMOTE", "HYBRID"] as const;
export const employerTypes = ["INDIVIDUAL", "SHOP", "STARTUP", "SME", "COMPANY", "AGENCY"] as const;
export const opaqueId = z.uuid();
export const citySchema = z.string().trim().max(80).regex(/^[\p{L}\p{M} .'’-]*$/u)
  .transform((value) => value.normalize("NFC").toLocaleLowerCase("vi")).nullable();
const unique = <T,>(items: T[]) => new Set(items).size === items.length;
const timezone = z.string().max(80).refine((value) => {
  if (!value.includes("/") && value !== "UTC") return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
export const availabilitySchema = z.array(z.strictObject({ weekday: z.number().int().min(0).max(6),
  startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24) }))
  .max(14).refine((slots) => slots.every((slot) => slot.startHour < slot.endHour) && slots.every((slot, index) =>
    slots.every((other, otherIndex) => index === otherIndex || slot.weekday !== other.weekday || slot.endHour <= other.startHour || other.endHour <= slot.startHour)));
export const workerSchema = z.strictObject({
  headline: plainText(160), bio: plainText(1000).default(""),
  city: citySchema, timezone: timezone.default("Asia/Ho_Chi_Minh"),
  preferences: z.array(z.enum(preferences)).max(7).refine(unique),
  workModes: z.array(z.enum(workModes)).max(3).refine(unique),
  skills: z.array(z.strictObject({ skillId: opaqueId, level: z.enum(levels) })).max(20)
    .refine((items) => unique(items.map((item) => item.skillId))),
  availability: availabilitySchema,
});
export const employerSchema = z.strictObject({ type: z.enum(employerTypes),
  description: plainText(1000).default(""), city: citySchema });
export const discoveryOptInSchema = z.strictObject({ discoverable: z.boolean() });
export const pageSchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(30).default(12),
  cursor: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).optional() });
export const discoverySchema = pageSchema.extend({ city: citySchema.optional(),
  cursor: opaqueId.optional(),
  skillId: z.preprocess((value) => value === "" ? undefined : value, opaqueId.optional()),
  preference: z.preprocess((value) => value === "" ? undefined : value, z.enum(preferences).optional()) });
const safeInputFields = new Set(["headline", "bio", "city", "timezone", "preferences", "workModes", "skills", "availability",
  "type", "description", "name", "website", "creationKey", "discoverable", "limit", "cursor", "skillId", "preference", "q",
  "title", "category", "employmentType", "workMode", "compensationType", "compensationMin", "compensationMax", "currency", "headcount", "startDate", "endDate", "schedule", "expectedVersion", "rating", "comment"]);
export class InputError extends AppError {
  constructor(readonly fields: string[]) { super("VALIDATION"); }
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputError([...new Set(result.error.issues.map((issue) =>
    typeof issue.path[0] === "string" && safeInputFields.has(issue.path[0]) ? issue.path[0] : "form"))]);
  return result.data;
}
export type WorkerInput = z.infer<typeof workerSchema>;
export type EmployerInput = z.infer<typeof employerSchema>;
export function completeness(profile: WorkerInput) {
  const availabilityRequired = profile.preferences.some((type) => ["PART_TIME", "TEMPORARY", "SHIFT"].includes(type));
  const checks = { headline: Boolean(profile.headline.trim()), location: Boolean(profile.city) || profile.workModes.includes("REMOTE"),
    workPreference: profile.preferences.length > 0 && profile.workModes.length > 0,
    skills: profile.skills.length > 0, ...(availabilityRequired ? { availability: profile.availability.length > 0 } : {}) };
  const missingFields = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return { complete: missingFields.length === 0, percentage: Math.round((Object.keys(checks).length - missingFields.length) / Object.keys(checks).length * 100), missingFields };
}
export function availabilityIndicator(slots: WorkerInput["availability"]) {
  return slots.length ? "AVAILABILITY_PROVIDED" as const : "NOT_SPECIFIED" as const;
}
export type WorkerSelf = WorkerInput & { id: string; displayName: string; discoverable: boolean; completeness: ReturnType<typeof completeness> };
export type WorkerDiscovery = { id: string; displayName: string; headline: string; city: string | null;
  preferences: WorkerInput["preferences"]; workModes: WorkerInput["workModes"];
  skills: { name: string; level: typeof levels[number] }[]; availability: ReturnType<typeof availabilityIndicator> };
export type EmployerSelf = EmployerInput & { id: string; displayName: string };
