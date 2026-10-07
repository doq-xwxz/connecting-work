import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Principal } from "@/modules/auth/policy";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { discoverWorkers, getEmployer, getWorker, listSkills } from "./service";
import { getCompany, listCompanies, listMembers } from "@/modules/companies/service";
import { WorkerForm } from "./components/worker-form";
import { EmployerForm } from "./components/employer-form";
import { CompanyForm, MemberControls } from "@/modules/companies/components/company-form";
import { preferences } from "./contracts";

export function MarketplaceNavigation() {
  return <nav aria-label="Khu vực hồ sơ" className="mb-8 flex flex-wrap gap-x-5 gap-y-3 text-sm underline">
    <Link href="/account">Tài khoản / vai trò</Link><Link href="/worker/profile">Hồ sơ tìm việc</Link>
    <Link href="/employer/profile">Hồ sơ người thuê</Link><Link href="/employer/companies">Công ty</Link><Link href="/employer/workers">Tìm người</Link><Link href="/employer/jobs">Quản lý tin</Link><Link href="/jobs">Tìm việc</Link>
  </nav>;
}
async function guarded(title: string, render: (actor: Principal) => Promise<ReactNode>) {
  let content: ReactNode;
  try { content = await render(await requireAuthenticatedUser(await headers())); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <div className="space-y-3"><p>Không thể mở khu vực này. Kiểm tra vai trò và hồ sơ của bạn hoặc thử lại sau.</p><Link className="underline" href="/account">Về tài khoản</Link></div>;
  }
  return <main className="mx-auto max-w-3xl px-6 py-12"><MarketplaceNavigation /><h1 className="mb-6 text-3xl font-semibold">{title}</h1>{content}</main>;
}
export function WorkerPage() {
  return guarded("Hồ sơ người tìm việc", async (actor) => {
    const [profile, skills] = await Promise.all([getWorker(getDb(), actor), listSkills(getDb(), actor)]);
    return <><p className="mb-5">Tên hiển thị: {actor.name}. Chọn kỹ năng, loại công việc và lịch có thể làm của bạn.</p><WorkerForm profile={profile} skills={skills} active={actor.status === "ACTIVE"} /></>;
  });
}
export function EmployerPage() {
  return guarded("Hồ sơ người thuê", async (actor) => <><p className="mb-5">Tên hiển thị: {actor.name}. Hồ sơ cá nhân này độc lập với các công ty bạn quản lý.</p><EmployerForm profile={await getEmployer(getDb(), actor)} active={actor.status === "ACTIVE"} /></>);
}
export function CompaniesPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  return guarded("Công ty của bạn", async (actor) => {
    const page = await listCompanies(getDb(), actor, query);
    return <div className="space-y-5"><Link className="inline-block rounded-md border px-4 py-2" href="/employer/companies/new">Tạo công ty</Link>
      {!page.items.length && <p>Bạn chưa có công ty trong danh sách này.</p>}
      <ul className="space-y-4">{page.items.map((company) => <li className="rounded-md border p-4" key={company.id}><Link className="font-semibold underline" href={`/employer/companies/${company.slug}`}>{company.name}</Link><p>{company.role} · {company.verification === "VERIFIED" ? "Đã xác minh" : "Chưa xác minh"}</p></li>)}</ul>
      {page.nextCursor && <Link className="underline" href={`/employer/companies?cursor=${encodeURIComponent(page.nextCursor)}`}>Trang tiếp</Link>}
    </div>;
  });
}
export function NewCompanyPage() {
  return guarded("Tạo công ty", async (actor) => {
    if (!await getEmployer(getDb(), actor)) return <Link className="underline" href="/employer/profile">Tạo hồ sơ người thuê trước</Link>;
    return <CompanyForm active={actor.status === "ACTIVE"} />;
  });
}
export function CompanyPage({ slug, query }: { slug: string; query: Record<string, string | string[] | undefined> }) {
  return guarded("Quản lý công ty", async (actor) => {
    const company = await getCompany(getDb(), actor, slug);
    const members = company.role === "OWNER" ? await listMembers(getDb(), actor, company.id, query) : null;
    return <><p className="mb-5">Vai trò hiện tại: {company.role} · {company.verification === "VERIFIED" ? "Đã xác minh" : "Chưa xác minh"}</p><CompanyForm company={company} active={actor.status === "ACTIVE"} />
      {members && <><MemberControls companyId={company.id} members={members.items} active={actor.status === "ACTIVE"} />
        {members.nextCursor && <Link className="mt-4 block underline" href={`/employer/companies/${company.slug}?cursor=${encodeURIComponent(members.nextCursor)}`}>Thành viên tiếp</Link>}</>}
    </>;
  });
}
export function DiscoveryPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  return guarded("Người tìm việc đã bật hiển thị", async (actor) => {
    const [page, skills] = await Promise.all([discoverWorkers(getDb(), actor, query), listSkills(getDb(), actor, "EMPLOYER")]);
    const nextQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "cursor") nextQuery.set(key, value);
    if (page.nextCursor) nextQuery.set("cursor", page.nextCursor);
    return <div className="space-y-6"><p>Chỉ hiển thị người đã chủ động bật quyền tìm thấy. Lịch chi tiết và thông tin liên hệ được giữ riêng.</p>
      <form className="grid gap-3 sm:grid-cols-2" action="/employer/workers">
        <label className="text-sm">Tỉnh/thành phố<input className="mt-1 w-full rounded-md border px-3 py-2" name="city" maxLength={80} defaultValue={typeof query.city === "string" ? query.city : ""} /></label>
        <label className="text-sm">Kỹ năng<select className="mt-1 w-full rounded-md border px-3 py-2" name="skillId" defaultValue={typeof query.skillId === "string" ? query.skillId : ""}><option value="">Tất cả</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
        <label className="text-sm">Loại công việc<select className="mt-1 w-full rounded-md border px-3 py-2" name="preference" defaultValue={typeof query.preference === "string" ? query.preference : ""}><option value="">Tất cả</option>{preferences.map((type) => <option key={type}>{type}</option>)}</select></label>
        <button className="self-end rounded-md bg-primary px-4 py-2 text-primary-foreground">Lọc</button>
      </form>
      {!page.items.length && <p>Chưa có hồ sơ phù hợp trong trang này.</p>}
      <ul className="space-y-4">{page.items.map((worker) => <li key={worker.id} className="rounded-md border p-5"><h2 className="text-lg font-semibold">{worker.displayName}</h2><p>{worker.headline}</p><p>{worker.city || (worker.workModes.includes("REMOTE") ? "Từ xa" : "Chưa cung cấp thành phố")} · {worker.workModes.join(", ")}</p><p>{worker.preferences.join(", ")}</p><ul className="mt-2 flex flex-wrap gap-3">{worker.skills.map((skill) => <li key={skill.name}>{skill.name} · {skill.level}</li>)}</ul><p className="mt-2 text-sm">{worker.availability === "AVAILABILITY_PROVIDED" ? "Đã cung cấp lịch có thể làm" : "Chưa cung cấp lịch"}</p></li>)}</ul>
      {page.nextCursor && <Link className="underline" href={`/employer/workers?${nextQuery}`}>Trang tiếp</Link>}
    </div>;
  });
}
