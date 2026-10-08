import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import type { Principal } from "@/modules/auth/policy";
import { listCompanies } from "@/modules/companies/service";
import { getEmployer, listSkills } from "@/modules/profiles/service";
import { MarketplaceNavigation } from "@/modules/profiles/pages";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { categories, compensationTypes, type JobInput, type PublicJob } from "./contracts";
import { publicSearchSkills } from "./search";
import { getManagedJob, getPublicJob, listManagedJobs, listPublicJobs } from "./service";
import { JobForm } from "./components/job-form";
import { JobActions } from "./components/job-actions";
import { preferences, workModes } from "@/modules/profiles/contracts";
import { getApplyState } from "@/modules/hiring/service";
import { ApplyButton } from "@/modules/hiring/components/actions";

type Query = Record<string, string | string[] | undefined>;
async function management(title: string, render: (actor: Principal) => Promise<ReactNode>) {
  let content: ReactNode;
  try { content = await render(await requireAuthenticatedUser(await headers())); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <p>Không thể mở khu vực này. Kiểm tra vai trò và hồ sơ người thuê hoặc thử lại sau.</p>;
  }
  return <main className="mx-auto max-w-3xl px-6 py-12"><MarketplaceNavigation /><h1 className="mb-6 text-3xl font-semibold">{title}</h1>{content}</main>;
}
function nextUrl(path: string, query: Query, cursor: string) {
  const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "cursor") params.set(key, value);
  params.set("cursor", cursor); return `${path}?${params}`;
}
export function Compensation({ job }: { job: JobInput }) {
  const format = (amount: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(BigInt(amount));
  return <p>{job.compensationMin !== null && job.compensationMax !== null ? `${format(job.compensationMin)}${job.compensationMin === job.compensationMax ? "" : ` – ${format(job.compensationMax)}`} / ${job.compensationType}` : "Chưa nhập thu nhập"}</p>;
}
export function JobsManagementPage({ query }: { query: Query }) {
  return management("Tin tuyển dụng của bạn", async (actor) => {
    const page = await listManagedJobs(getDb(), actor, query);
    return <div className="space-y-5"><p>Hạn mức cá nhân: {page.personalQuota.active}/{page.personalQuota.limit} tin active. Tin tạm dừng vẫn tính hạn mức; mỗi công ty có hạn mức riêng.</p>
      <Link className="inline-block rounded-md border px-4 py-2" href="/employer/jobs/new">Tạo tin nháp</Link>
      <Link className="ml-4 underline" href="/jobs">Xem tin công khai</Link>
      {!page.items.length && <p>Chưa có tin trong danh sách này.</p>}
      <ul className="space-y-4">{page.items.map((job) => <li key={job.id} className="rounded-md border p-4"><Link className="text-lg font-semibold underline" href={`/employer/jobs/${job.id}`}>{job.title || "Tin nháp chưa có tiêu đề"}</Link>
        <p>{job.owner.kind === "COMPANY" ? "Công ty" : "Cá nhân"}: {job.owner.displayName} · {job.status}</p><p>Hạn mức chủ thể: {job.quota.active}/{job.quota.limit}</p><Compensation job={job} /></li>)}</ul>
      {page.nextCursor && <Link className="underline" href={nextUrl("/employer/jobs", query, page.nextCursor)}>Trang tiếp</Link>}
    </div>;
  });
}
export function JobNewPage({ query }: { query: Query }) {
  return management("Tạo tin tuyển dụng nháp", async (actor) => {
    if (!await getEmployer(getDb(), actor)) return <Link className="underline" href="/employer/profile">Tạo hồ sơ người thuê trước</Link>;
    const [companies, skills] = await Promise.all([listCompanies(getDb(), actor, query), listSkills(getDb(), actor, "EMPLOYER")]);
    return <><p className="mb-5">Bản nháp không tiêu hao hạn mức. Bạn có thể lưu trước rồi hoàn thiện để đăng.</p><JobForm skills={skills} companies={companies.items} active={actor.status === "ACTIVE"} />
      {companies.nextCursor && <Link className="mt-5 block underline" href={nextUrl("/employer/jobs/new", query, companies.nextCursor)}>Các công ty tiếp theo</Link>}</>;
  });
}
export function JobManagementPage({ id, edit = false }: { id: string; edit?: boolean }) {
  return management(edit ? "Sửa nội dung tin" : "Quản lý tin tuyển dụng", async (actor) => {
    const [job, skills] = await Promise.all([getManagedJob(getDb(), actor, id), listSkills(getDb(), actor, "EMPLOYER")]);
    return <><h2 className="text-xl font-semibold">{job.title || "Tin nháp"}</h2><p>{job.owner.displayName} · {job.owner.kind} · {job.status}</p><p className="mt-3">Hạn mức: {job.quota.active}/{job.quota.limit} tin active</p>
      <p className="mt-3">{job.publishValidation.valid ? "Nội dung đã đủ để kiểm tra đăng tin." : `Còn thiếu: ${job.publishValidation.missingFields.join(", ")}`}</p>
      <p className="text-sm">Đăng/tiếp tục còn yêu cầu email đã xác thực, tài khoản được phép hoạt động và hạn mức.</p>
      <JobActions job={job} active={actor.status === "ACTIVE"} />
      <Link className="mb-5 block underline" href={`/employer/jobs/${job.id}/applications`}>Quản lý ứng viên</Link>
      <Link className="mb-5 block underline" href={`/employer/jobs/${job.id}/candidates`}>Gợi ý người phù hợp</Link>
      {!edit && <Link className="mb-5 block underline" href={`/employer/jobs/${job.id}/edit`}>Mở trang chỉnh sửa</Link>}
      <JobForm job={job} skills={skills} active={actor.status === "ACTIVE"} /></>;
  });
}
function PublicJobCard({ job }: { job: PublicJob }) {
  return <article className="rounded-md border p-5"><h2 className="text-xl font-semibold"><Link className="underline" href={`/jobs/${job.id}`}>{job.title}</Link></h2>
    <p>{job.owner.displayName}{job.owner.verification === "VERIFIED" ? " · Công ty đã xác minh" : job.owner.kind === "COMPANY" ? " · Công ty chưa xác minh" : ""}</p>
    <p>{job.city || "Từ xa"} · {job.workMode} · {job.employmentType}</p><Compensation job={job} /><p>Cần {job.headcount} người</p></article>;
}
export async function PublicJobsPage({ query }: { query: Query }) {
  let content: ReactNode;
  let skills: { id: string; name: string }[] = [];
  try {
    const [page, availableSkills] = await Promise.all([listPublicJobs(getDb(), query), publicSearchSkills(getDb())]);
    skills = availableSkills;
    content = <><ul className="space-y-4">{page.items.map((job) => <li key={job.id}><PublicJobCard job={job} /></li>)}</ul>
      {!page.items.length && <p>Chưa có tin đang đăng phù hợp trong trang này.</p>}
      {page.nextCursor && <Link className="mt-6 block underline" href={nextUrl("/jobs", query, page.nextCursor)}>Trang tiếp</Link>}</>;
  } catch { content = <p>Không thể tải danh sách. Kiểm tra bộ lọc hoặc thử lại sau.</p>; }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><nav className="flex gap-5 underline"><Link href="/">Trang chủ</Link><Link href="/employer/jobs">Quản lý tin</Link></nav><h1 className="text-3xl font-semibold">Tin tuyển dụng đang đăng</h1>
    <form className="grid gap-3 sm:grid-cols-2" action="/jobs"><label>Từ khóa<input className="mt-1 w-full rounded-md border p-2" name="q" maxLength={200} defaultValue={typeof query.q === "string" ? query.q : ""} /></label><label>Tỉnh/thành phố<input className="mt-1 w-full rounded-md border p-2" name="city" maxLength={80} defaultValue={typeof query.city === "string" ? query.city : ""} /></label>
      <label>Kỹ năng<select className="mt-1 w-full rounded-md border p-2" name="skillId" defaultValue={typeof query.skillId === "string" ? query.skillId : ""}><option value="">Tất cả</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
      <label>Đơn vị thu nhập<select className="mt-1 w-full rounded-md border p-2" name="compensationType" defaultValue={typeof query.compensationType === "string" ? query.compensationType : ""}><option value="">Tất cả</option>{compensationTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label>Thu nhập từ (VND)<input className="mt-1 w-full rounded-md border p-2" name="compensationMin" inputMode="numeric" maxLength={13} defaultValue={typeof query.compensationMin === "string" ? query.compensationMin : ""} /></label>
      <label>Thu nhập đến (VND)<input className="mt-1 w-full rounded-md border p-2" name="compensationMax" inputMode="numeric" maxLength={13} defaultValue={typeof query.compensationMax === "string" ? query.compensationMax : ""} /></label>
      <label>Loại công việc<select className="mt-1 w-full rounded-md border p-2" name="employmentType" defaultValue={typeof query.employmentType === "string" ? query.employmentType : ""}><option value="">Tất cả</option>{preferences.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label>Hình thức<select className="mt-1 w-full rounded-md border p-2" name="workMode" defaultValue={typeof query.workMode === "string" ? query.workMode : ""}><option value="">Tất cả</option>{workModes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
      <label>Nhóm nghề<select className="mt-1 w-full rounded-md border p-2" name="category" defaultValue={typeof query.category === "string" ? query.category : ""}><option value="">Tất cả</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Lọc tin</button></form>{content}</main>;
}
export async function PublicJobPage({ id }: { id: string }) {
  let job: PublicJob;
  try { job = await getPublicJob(getDb(), id); }
  catch (error) {
    if (error instanceof AppError && ["NOT_FOUND", "VALIDATION"].includes(error.code)) notFound();
    return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="text-2xl font-semibold">Không thể tải tin</h1><Link href="/jobs">Về danh sách</Link></main>;
  }
  const days = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  let apply: ReactNode = <p>Hoàn thiện hồ sơ tìm việc và xác thực email để ứng tuyển.</p>;
  try {
    const actor = await requireAuthenticatedUser(await headers());
    const state = await getApplyState(getDb(), actor, id);
    if (state.applicationId) apply = <Link className="underline" href={`/worker/applications/${state.applicationId}`}>Xem hồ sơ ứng tuyển của bạn</Link>;
    else if (state.eligible) apply = <ApplyButton jobId={id} />;
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") apply = <Link className="underline" href="/sign-in">Đăng nhập để ứng tuyển</Link>;
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-6 py-12"><Link className="underline" href="/jobs">Về danh sách</Link><h1 className="text-3xl font-semibold">{job.title}</h1>
    <p>{job.owner.displayName} · {job.owner.kind === "COMPANY" ? (job.owner.verification === "VERIFIED" ? "Công ty đã xác minh" : "Công ty chưa xác minh") : "Người thuê cá nhân"}</p>
    <p>{job.category} · {job.employmentType} · {job.workMode} · {job.city || "Từ xa"}</p><Compensation job={job} /><p>Cần {job.headcount} người</p>
    <p className="whitespace-pre-wrap">{job.description}</p><p>Thời gian: {job.startDate || "Chưa xác định ngày bắt đầu"} → {job.endDate || "Chưa xác định ngày kết thúc"}</p>
    <section><h2 className="text-xl font-semibold">Lịch làm việc · {job.timezone}</h2><ul>{job.schedule.map((slot) => <li key={`${slot.weekday}-${slot.startHour}`}>{days[slot.weekday]}: {slot.startHour}:00–{slot.endHour}:00</li>)}</ul>{!job.schedule.length && <p>Không có lịch tuần cố định.</p>}</section>
    <section><h2 className="text-xl font-semibold">Kỹ năng</h2><ul>{job.skills.map((skill) => <li key={skill.skillId}>{skill.name} · {skill.minimumLevel} · {skill.required ? "Bắt buộc" : "Ưu tiên"}</li>)}</ul></section>
    <section className="rounded-md border p-4">{apply}</section></main>;
}
