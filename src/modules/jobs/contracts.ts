import { z } from "zod";
import { availabilitySchema, citySchema, levels, opaqueId, pageSchema, preferences, workerSchema, workModes } from "@/modules/profiles/contracts";

export const statuses = ["DRAFT", "PUBLISHED", "PAUSED", "CLOSED", "COMPLETED", "CANCELLED"] as const;
export const actions = ["publish", "pause", "resume", "close", "cancel"] as const;
export const categories = ["ADMIN_OPERATIONS", "FINANCE_ACCOUNTING", "MARKETING", "CREATIVE", "GENERAL_PART_TIME"] as const;
export const compensationTypes = ["HOURLY", "DAILY", "PROJECT", "MONTHLY"] as const;
export const FREE_ACTIVE_LIMIT = 3;
// VND has zero fractional minor digits. Strings prevent JSON/JS float coercion.
export const moneySchema = z.string().refine((value) => /^(0|[1-9][0-9]{0,12})$/.test(value) && BigInt(value) <= 1_000_000_000_000n);
const dateOnly = z.iso.date().refine((value) => value >= "2000-01-01" && value <= "2100-12-31");
const skillSchema = z.strictObject({ skillId: opaqueId, required: z.boolean(), minimumLevel: z.enum(levels) });
export const termShape = {
  title: z.string().trim().max(160), description: z.string().trim().max(6000), category: z.enum(categories).nullable(),
  employmentType: z.enum(preferences).nullable(), workMode: z.enum(workModes).nullable(), city: citySchema,
  compensationType: z.enum(compensationTypes).nullable(), compensationMin: moneySchema.nullable(), compensationMax: moneySchema.nullable(),
  currency: z.literal("VND"), headcount: z.number().int().min(1).max(1000),
  startDate: dateOnly.nullable(), endDate: dateOnly.nullable(), timezone: workerSchema.shape.timezone,
  skills: z.array(skillSchema).max(20).refine((items) => new Set(items.map((item) => item.skillId)).size === items.length),
  schedule: availabilitySchema,
};
function consistentTerms(input: z.infer<z.ZodObject<typeof termShape>>) {
  const pair = (input.compensationMin === null) === (input.compensationMax === null);
  return pair && (input.compensationMin === null || (input.compensationType !== null && moneySchema.safeParse(input.compensationMin).success
    && moneySchema.safeParse(input.compensationMax).success && BigInt(input.compensationMin) <= BigInt(input.compensationMax!)))
    && (!input.endDate || Boolean(input.startDate && input.endDate >= input.startDate));
}
export const jobSchema = z.strictObject(termShape).refine(consistentTerms);
export const createJobSchema = z.strictObject({ ...termShape, companyId: opaqueId.nullable(), creationKey: opaqueId }).refine(consistentTerms);
export const updateJobSchema = z.strictObject({ ...termShape, expectedVersion: z.number().int().min(1).max(2_147_483_647) }).refine(consistentTerms);
export const transitionSchema = z.strictObject({ expectedVersion: z.number().int().min(1).max(2_147_483_647) });
export const duplicateSchema = z.strictObject({ creationKey: opaqueId });
const emptyOptional = <T>(schema: z.ZodType<T>) => z.preprocess((value) => value === "" ? undefined : value, schema.optional());
export const publicQuerySchema = pageSchema.extend({ cursor: opaqueId.optional(), city: citySchema.optional(),
  employmentType: emptyOptional(z.enum(preferences)), workMode: emptyOptional(z.enum(workModes)),
  category: emptyOptional(z.enum(categories)), skillId: emptyOptional(opaqueId) });
export const managementQuerySchema = pageSchema.extend({ cursor: opaqueId.optional(), status: emptyOptional(z.enum(statuses)), companyId: emptyOptional(opaqueId),
  personal: z.enum(["true"]).optional() }).refine((query) => !(query.personal && query.companyId));

export type JobInput = z.infer<typeof jobSchema>;
export type JobStatus = typeof statuses[number];
export type JobAction = typeof actions[number];
export type Quota = { scope: "PERSONAL" | "COMPANY"; active: number; limit: number };
export type JobOwner = { kind: "PERSONAL" | "COMPANY"; displayName: string; companySlug: string | null; verification: "UNVERIFIED" | "VERIFIED" | null };
// Explicit serializable terms, ready for future transaction-owned immutable snapshots.
export type JobTerms = Readonly<JobInput> & { readonly schemaVersion: 1 };
export type PublicJob = Omit<JobInput, "skills"> & { skills: (JobInput["skills"][number] & { name: string })[]; id: string; owner: JobOwner; publishedAt: string };
export type ManagedJob = JobInput & { id: string; owner: JobOwner; status: JobStatus; version: number;
  createdAt: string; updatedAt: string; publishedAt: string | null; closedAt: string | null; cancelledAt: string | null;
  quota: Quota; publishValidation: { valid: boolean; missingFields: string[] } };
