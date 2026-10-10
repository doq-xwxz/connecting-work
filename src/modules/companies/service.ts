import { transaction } from "@/shared/db/transaction";
import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/modules/auth/policy";
import { currentActor } from "@/modules/auth/transaction";
import { requireEmployerProfile } from "@/modules/profiles/access";
import { opaqueId, pageSchema, parse } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";
import { companySchema, companySlug, createCompanySchema, publicCompanyDto, requireCompanyRole,
  type CompanyManagement, type CompanyMemberDto } from "./contracts";

const companySelect = { id: true, slug: true, name: true, description: true, city: true, website: true, verification: true } satisfies Prisma.CompanySelect;
// Current membership only. Creator provenance is deliberately absent from this check.
export async function requireCompanyMembership(tx: Prisma.TransactionClient, actorId: string, companyId: string, required: "OWNER" | "MANAGER" = "MANAGER") {
  const member = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: actorId } }, select: { role: true } });
  if (!member) throw new AppError("NOT_FOUND");
  requireCompanyRole(member.role, required);
  return member;
}
async function lockCompany(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR UPDATE`;
}
export async function createCompany(db: PrismaClient, actor: Principal, raw: unknown): Promise<CompanyManagement> {
  const { creationKey, ...input } = parse(createCompanySchema, raw);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    await requireEmployerProfile(tx, actor.id);
    const previous = await tx.company.findUnique({ where: { createdByUserId_creationKey: { createdByUserId: actor.id, creationKey } }, select: { id: true } });
    if (previous) {
      await lockCompany(tx, previous.id);
      const member = await requireCompanyMembership(tx, actor.id, previous.id);
      const current = await tx.company.findUniqueOrThrow({ where: { id: previous.id }, select: companySelect });
      if (current.name !== input.name || current.description !== input.description || current.city !== (input.city || null) || current.website !== input.website) throw new AppError("CONFLICT");
      return { ...publicCompanyDto(current), id: current.id, role: member.role };
    }
    const row = await tx.company.create({ data: { ...input, city: input.city || null, creationKey,
      slug: companySlug(input.name, randomBytes(8).toString("hex")), createdByUserId: actor.id,
      members: { create: { userId: actor.id, role: "OWNER" } } }, select: companySelect });
    return { ...publicCompanyDto(row), id: row.id, role: "OWNER" };
    }); } catch (error) {
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && Array.isArray(target) && target.includes("slug"))) throw error;
      // Retry the complete atomic operation with a fresh suffix; never reuse an aborted transaction.
    }
  }
  throw new AppError("CONFLICT");
}
export async function listCompanies(db: PrismaClient, actor: Principal, raw: unknown) {
  const query = parse(pageSchema.extend({ cursor: opaqueId.optional() }), raw);
  return transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER");
    await requireEmployerProfile(tx, actor.id);
    const rows = await tx.companyMember.findMany({ where: { userId: actor.id, ...(query.cursor ? { companyId: { gt: query.cursor } } : {}) },
      select: { role: true, company: { select: companySelect } }, orderBy: { companyId: "asc" }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map((row): CompanyManagement => ({ ...publicCompanyDto(row.company), id: row.company.id, role: row.role })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.company.id : null };
  });
}
export async function getCompany(db: PrismaClient, actor: Principal, slug: string): Promise<CompanyManagement> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) throw new AppError("NOT_FOUND");
  return transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER");
    await requireEmployerProfile(tx, actor.id);
    const row = await tx.company.findFirst({ where: { slug, members: { some: { userId: actor.id } } }, select: companySelect });
    if (!row) throw new AppError("NOT_FOUND");
    const member = await requireCompanyMembership(tx, actor.id, row.id);
    return { ...publicCompanyDto(row), id: row.id, role: member.role };
  });
}
export async function updateCompany(db: PrismaClient, actor: Principal, companyId: string, raw: unknown): Promise<CompanyManagement> {
  parse(opaqueId, companyId); const input = parse(companySchema, raw);
  return transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    await requireEmployerProfile(tx, actor.id);
    await lockCompany(tx, companyId);
    const member = await requireCompanyMembership(tx, actor.id, companyId);
    const row = await tx.company.update({ where: { id: companyId }, data: { ...input, city: input.city || null }, select: companySelect });
    return { ...publicCompanyDto(row), id: row.id, role: member.role };
  });
}
export async function listMembers(db: PrismaClient, actor: Principal, companyId: string, raw: unknown) {
  parse(opaqueId, companyId); const query = parse(pageSchema, raw);
  return transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER");
    await requireEmployerProfile(tx, actor.id);
    await requireCompanyMembership(tx, actor.id, companyId, "OWNER");
    const rows = await tx.companyMember.findMany({ where: { companyId, ...(query.cursor ? { userId: { gt: query.cursor } } : {}) },
      select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { userId: "asc" }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: page.map((row): CompanyMemberDto => ({ memberId: row.userId, displayName: row.user.name, role: row.role })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.userId : null };
  });
}
export async function removeManager(db: PrismaClient, actor: Principal, companyId: string, memberId: string) {
  parse(opaqueId, companyId);
  // Better Auth identity IDs are opaque strings, not necessarily UUIDs.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberId)) throw new AppError("VALIDATION");
  return transaction(db, async (tx) => {
    await currentActor(tx, actor, "EMPLOYER", true, true);
    await requireEmployerProfile(tx, actor.id);
    await lockCompany(tx, companyId);
    await requireCompanyMembership(tx, actor.id, companyId, "OWNER");
    const target = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: memberId } }, select: { role: true } });
    if (!target) throw new AppError("NOT_FOUND");
    if (target.role === "OWNER") throw new AppError("CONFLICT");
    await tx.companyMember.delete({ where: { companyId_userId: { companyId, userId: memberId } } });
    return { ok: true };
  });
}
