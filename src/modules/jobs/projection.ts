import type { Prisma } from "@/generated/prisma/client";
import { type JobInput, type JobOwner, type ManagedJob, type PublicJob, type Quota } from "./contracts";
import { publishValidation } from "./policy";

export const jobSelect = { id: true, title: true, description: true, category: true, status: true, version: true,
  employmentType: true, workMode: true, city: true, compensationType: true, compensationMin: true, compensationMax: true,
  currency: true, headcount: true, startDate: true, endDate: true, timezone: true, companyId: true, employerProfileId: true,
  createdAt: true, updatedAt: true, publishedAt: true, closedAt: true, cancelledAt: true,
  employer: { select: { user: { select: { name: true } } } },
  company: { select: { name: true, slug: true, verification: true } },
  skills: { select: { skillId: true, required: true, minimumLevel: true, skill: { select: { name: true, active: true } } }, orderBy: { skillId: "asc" } },
  schedule: { select: { weekday: true, startHour: true, endHour: true }, orderBy: [{ weekday: "asc" }, { startHour: "asc" }] },
} satisfies Prisma.JobSelect;
export type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>;
export function inputFromRow(row: JobRow): JobInput {
  return { title: row.title, description: row.description, category: row.category, employmentType: row.employmentType,
    workMode: row.workMode, city: row.city, compensationType: row.compensationType,
    compensationMin: row.compensationMin?.toString() ?? null, compensationMax: row.compensationMax?.toString() ?? null,
    currency: "VND", headcount: row.headcount, startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: row.endDate?.toISOString().slice(0, 10) ?? null, timezone: row.timezone,
    skills: row.skills.map(({ skillId, required, minimumLevel }) => ({ skillId, required, minimumLevel })),
    schedule: row.schedule.map(({ weekday, startHour, endHour }) => ({ weekday, startHour, endHour })) };
}
function ownerDto(row: JobRow): JobOwner {
  return row.company ? { kind: "COMPANY", displayName: row.company.name, companySlug: row.company.slug, verification: row.company.verification }
    : { kind: "PERSONAL", displayName: row.employer.user.name, companySlug: null, verification: null };
}
export function publicJobDto(row: JobRow): PublicJob {
  return { ...inputFromRow(row), skills: row.skills.map(({ skillId, required, minimumLevel, skill }) => ({ skillId, required, minimumLevel, name: skill.name })),
    id: row.id, owner: ownerDto(row), publishedAt: row.publishedAt!.toISOString() };
}
export function managedJobDto(row: JobRow, quota: Quota): ManagedJob {
  const input = inputFromRow(row);
  return { ...input, id: row.id, owner: ownerDto(row), status: row.status, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null,
    quota, publishValidation: publishValidation(input, row.skills.every((item) => item.skill.active)) };
}
