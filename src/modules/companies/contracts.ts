import { z } from "zod";
import { citySchema, opaqueId } from "@/modules/profiles/contracts";
import { AppError } from "@/shared/errors/app-error";

const website = z.url().max(300).refine((value) => {
  const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}).nullable();
export const companySchema = z.strictObject({ name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(""), city: citySchema, website });
export const createCompanySchema = companySchema.extend({ creationKey: opaqueId });
export const companyRoleSchema = z.enum(["OWNER", "MANAGER"]);
export function requireCompanyRole(role: "OWNER" | "MANAGER", required: "OWNER" | "MANAGER") {
  if (required === "OWNER" && role !== "OWNER") throw new AppError("FORBIDDEN");
}
export function companySlug(name: string, suffix: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/g, "");
  return `${normalized || "cong-ty"}-${suffix}`;
}
export type CompanyPublic = { slug: string; name: string; description: string; city: string | null; website: string | null; verification: "UNVERIFIED" | "VERIFIED" };
export type CompanyManagement = CompanyPublic & { id: string; role: "OWNER" | "MANAGER" };
export type CompanyMemberDto = { memberId: string; displayName: string; role: "OWNER" | "MANAGER" };
export function publicCompanyDto(row: CompanyPublic): CompanyPublic {
  return { slug: row.slug, name: row.name, description: row.description, city: row.city, website: row.website, verification: row.verification };
}
