import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { AppError } from "@/shared/errors/app-error";
import { requireEmployerProfile, requireWorkerProfile } from "./access";
import { availabilityIndicator, completeness, discoveryOptInSchema, discoverySchema, employerSchema, opaqueId, parse, workerSchema,
  type EmployerSelf, type WorkerDiscovery, type WorkerInput, type WorkerSelf } from "./contracts";

export const workerSelect = { id: true, headline: true, bio: true, city: true, timezone: true, discoverable: true,
  user: { select: { name: true } }, preferences: { select: { type: true }, orderBy: { type: "asc" } },
  workModes: { select: { mode: true }, orderBy: { mode: "asc" } },
  skills: { where: { skill: { active: true } }, select: { skillId: true, level: true, skill: { select: { name: true } } }, orderBy: { skillId: "asc" } },
  availability: { select: { weekday: true, startHour: true, endHour: true }, orderBy: [{ weekday: "asc" }, { startHour: "asc" }] },
} satisfies Prisma.WorkerProfileSelect;
type WorkerRow = Prisma.WorkerProfileGetPayload<{ select: typeof workerSelect }>;
export function selfWorkerDto(row: WorkerRow): WorkerSelf {
  const input: WorkerInput = { headline: row.headline, bio: row.bio, city: row.city, timezone: row.timezone,
    preferences: row.preferences.map((item) => item.type), workModes: row.workModes.map((item) => item.mode),
    skills: row.skills.map((item) => ({ skillId: item.skillId, level: item.level })),
    availability: row.availability.map((item) => ({ weekday: item.weekday, startHour: item.startHour, endHour: item.endHour })) };
  return { id: row.id, displayName: row.user.name, ...input, discoverable: row.discoverable, completeness: completeness(input) };
}
export function discoveryWorkerDto(row: WorkerRow): WorkerDiscovery {
  return { id: row.id, displayName: row.user.name, headline: row.headline, city: row.city,
    preferences: row.preferences.map((item) => item.type), workModes: row.workModes.map((item) => item.mode),
    skills: row.skills.map((item) => ({ name: item.skill.name, level: item.level })), availability: availabilityIndicator(row.availability) };
}
export async function listSkills(db: PrismaClient, actor: Principal, role: "WORKER" | "EMPLOYER" = "WORKER") {
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, role);
    if (role === "EMPLOYER") await requireEmployerProfile(tx, actor.id);
    return tx.skill.findMany({ where: { active: true }, select: { id: true, name: true, category: true }, orderBy: [{ category: "asc" }, { slug: "asc" }], take: 100 });
  });
}
export async function getWorker(db: PrismaClient, actor: Principal) {
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "WORKER");
    const row = await tx.workerProfile.findUnique({ where: { userId: actor.id }, select: workerSelect });
    return row ? selfWorkerDto(row) : null;
  });
}
export async function saveWorker(db: PrismaClient, actor: Principal, raw: unknown, targetId?: string) {
  const input = parse(workerSchema, raw);
  if (targetId) parse(opaqueId, targetId);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "WORKER", true, true);
    const existing = await tx.workerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (targetId && existing?.id !== targetId) throw new AppError("NOT_FOUND");
    if (!targetId && existing) throw new AppError("CONFLICT");
    const count = await tx.skill.count({ where: { id: { in: input.skills.map((item) => item.skillId) }, active: true } });
    if (count !== input.skills.length) throw new AppError("VALIDATION");
    const data = { headline: input.headline, city: input.city || null, bio: input.bio, timezone: input.timezone };
    const row = targetId ? await tx.workerProfile.update({ where: { id: targetId }, data, select: { id: true } })
      : await tx.workerProfile.create({ data: { ...data, userId: actor.id }, select: { id: true } });
    await tx.workerSkill.deleteMany({ where: { workerProfileId: row.id } });
    await tx.workerPreference.deleteMany({ where: { workerProfileId: row.id } });
    await tx.workerWorkMode.deleteMany({ where: { workerProfileId: row.id } });
    await tx.workerAvailability.deleteMany({ where: { workerProfileId: row.id } });
    await tx.workerSkill.createMany({ data: input.skills.map((item) => ({ workerProfileId: row.id, ...item })) });
    await tx.workerPreference.createMany({ data: input.preferences.map((type) => ({ workerProfileId: row.id, type })) });
    await tx.workerWorkMode.createMany({ data: input.workModes.map((mode) => ({ workerProfileId: row.id, mode })) });
    await tx.workerAvailability.createMany({ data: input.availability.map((item) => ({ workerProfileId: row.id, ...item })) });
    return selfWorkerDto(await tx.workerProfile.findUniqueOrThrow({ where: { id: row.id }, select: workerSelect }));
  });
}
export async function setDiscoverable(db: PrismaClient, actor: Principal, targetId: string, raw: unknown) {
  parse(opaqueId, targetId);
  const input = parse(discoveryOptInSchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "WORKER", input.discoverable, true);
    const own = await requireWorkerProfile(tx, actor.id);
    if (own.id !== targetId) throw new AppError("NOT_FOUND");
    await tx.workerProfile.update({ where: { id: own.id }, data: input });
    return { discoverable: input.discoverable };
  });
}
export async function getEmployer(db: PrismaClient, actor: Principal): Promise<EmployerSelf | null> {
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "EMPLOYER");
    const row = await tx.employerProfile.findUnique({ where: { userId: actor.id }, select: { id: true, type: true, description: true, city: true } });
    return row ? { ...row, displayName: user.name } : null;
  });
}
export async function saveEmployer(db: PrismaClient, actor: Principal, raw: unknown, targetId?: string): Promise<EmployerSelf> {
  const input = parse(employerSchema, raw);
  if (targetId) parse(opaqueId, targetId);
  return db.$transaction(async (tx) => {
    const user = await currentActor(tx, actor, "EMPLOYER", true, true);
    const existing = await tx.employerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (targetId && existing?.id !== targetId) throw new AppError("NOT_FOUND");
    if (!targetId && existing) throw new AppError("CONFLICT");
    const data = { ...input, city: input.city || null };
    const select = { id: true, type: true, description: true, city: true };
    const row = targetId ? await tx.employerProfile.update({ where: { id: targetId }, data, select })
      : await tx.employerProfile.create({ data: { ...data, userId: actor.id }, select });
    return { ...row, displayName: user.name };
  });
}
export async function discoverWorkers(db: PrismaClient, actor: Principal, raw: unknown) {
  const query = parse(discoverySchema, raw);
  return db.$transaction(async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true);
    await requireEmployerProfile(tx, actor.id);
    // No shared cache or detached search index can retain withdrawn opt-in.
    const rows = await tx.workerProfile.findMany({ where: { discoverable: true,
      user: { status: "ACTIVE", roles: { some: { role: "WORKER" } } },
      ...(query.cursor ? { id: { gt: query.cursor } } : {}), ...(query.city ? { city: query.city } : {}),
      ...(query.skillId ? { skills: { some: { skillId: query.skillId, skill: { active: true } } } } : {}),
      ...(query.preference ? { preferences: { some: { type: query.preference } } } : {}),
    }, select: workerSelect, orderBy: { id: "asc" }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map(discoveryWorkerDto), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  });
}
