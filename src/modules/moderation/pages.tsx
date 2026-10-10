import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Principal } from "@/modules/auth/policy";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { parse } from "@/modules/profiles/contracts";
import { caseStatuses, reportContextSchema, severities, targets, targetSchema, type Target } from "./contracts";
import { caseDetail, caseReports, caseTimeline, listAdminReports, listCases, listOwnReports, reportFormTarget, reportCounterpartyTarget } from "./service";
import { CaseControls, CreateCaseForm, ReportForm } from "./components/forms";

type Query = Record<string, string | string[] | undefined>;
async function guarded(title: string, render: (actor: Principal) => Promise<ReactNode>) {
  let content: ReactNode, showAdmin = false;
  try { const actor = await requireAuthenticatedUser(await headers()); showAdmin = actor.status === "ACTIVE" && actor.roles.includes("ADMIN"); content = await render(actor); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <p>Không thể mở khu vực này. Kiểm tra quyền và trạng thái tài khoản.</p>;
  }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><nav className="flex flex-wrap gap-4 underline"><Link href="/account">Tài khoản</Link><Link href="/account/reports">Báo cáo của tôi</Link>{showAdmin && <><Link href="/admin/cases">Cases</Link><Link href="/admin/reports">Báo cáo cần xử lý</Link><Link href="/admin/analytics">Analytics</Link></>}</nav><h1 className="text-3xl font-semibold">{title}</h1>{content}</main>;
}
function nextLink(query: Query, cursor: string | null, parameter = "cursor") {
  if (!cursor) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
  params.set(parameter, cursor);
  return <Link className="block underline" href={`?${params}`}>Trang tiếp ({parameter})</Link>;
}
export function NewReportPage({ query }: { query: Query }) {
  return guarded("Báo cáo nội dung hoặc hành vi", async (actor) => {
    if ("applicationId" in query) {
      const context = parse(reportContextSchema, query), target = await reportCounterpartyTarget(getDb(), actor, context);
      return <><p>Báo cáo đối tác trong quan hệ ứng tuyển. Danh tính người báo cáo được giữ riêng.</p><ReportForm targetType={target.targetType} context={context} /></>;
    }
    const target = parse(targetSchema, query); await reportFormTarget(getDb(), actor, target);
    return <><p>Đối tượng: {target.targetType}. Danh tính người báo cáo được giữ riêng với đối tượng bị báo cáo.</p><ReportForm {...target} /></>;
  });
}
export function OwnReportsPage({ query }: { query: Query }) {
  return guarded("Báo cáo của tôi", async (actor) => {
    const page = await listOwnReports(getDb(), actor, query);
    return <><ul className="space-y-3">{page.items.map((r) => <li className="rounded-md border p-4" key={r.id}><p>{r.targetSummary} · {r.reasonCode} · {r.status}</p><p>{new Date(r.createdAt).toLocaleString("vi-VN")}</p></li>)}</ul>{!page.items.length && <p>Chưa có báo cáo.</p>}{nextLink(query, page.nextCursor)}</>;
  });
}
function Filters({ cases }: { cases: boolean }) {
  return <form className="grid gap-3 sm:grid-cols-3"><label>Trạng thái<select name="status" className="block w-full rounded-md border p-2"><option value="">Tất cả</option>{(cases ? caseStatuses : ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]).map((s) => <option key={s}>{s}</option>)}</select></label>
    <label>Đối tượng<select name="targetType" className="block w-full rounded-md border p-2"><option value="">Tất cả</option>{targets.map((t) => <option key={t}>{t}</option>)}</select></label>
    {cases && <label>Ưu tiên<select name="severity" className="block w-full rounded-md border p-2"><option value="">Tất cả</option>{severities.map((s) => <option key={s}>{s}</option>)}</select></label>}<button className="rounded-md border p-2">Lọc</button></form>;
}
function removeEmpty(query: Query) { return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== "")); }
export function CasesPage({ query }: { query: Query }) {
  return guarded("Cases moderation", async (actor) => {
    const page = await listCases(getDb(), actor, removeEmpty(query));
    return <><Filters cases /><ul className="space-y-3">{page.items.map((c) => <li className="rounded-md border p-4" key={c.id}><Link className="underline" href={`/admin/cases/${c.id}`}>{c.targetType} · {c.status} · {c.severity}</Link><p className="break-all">{c.targetId}</p></li>)}</ul>{nextLink(query, page.nextCursor)}<CreateCaseForm /></>;
  });
}
export function AdminReportsPage({ query }: { query: Query }) {
  return guarded("Báo cáo cần xử lý", async (actor) => {
    const page = await listAdminReports(getDb(), actor, removeEmpty(query));
    return <><Filters cases={false} /><ul className="space-y-4">{page.items.map((r) => <li className="rounded-md border p-4" key={r.id}><p>{r.targetType} · {r.reasonCode} · {r.status}</p><p className="break-all">{r.targetId}</p>
      {r.caseId ? <Link className="underline" href={`/admin/cases/${r.caseId}`}>Mở case</Link> : r.status === "OPEN" ? <CreateCaseForm seed={{ targetType: r.targetType, targetId: r.targetId, reportId: r.id }} /> : null}</li>)}</ul>{nextLink(query, page.nextCursor)}</>;
  });
}
export function CasePage({ id, query }: { id: string; query: Query }) {
  return guarded("Chi tiết case", async (actor) => {
    const permitted = ["auditCursor", "reportCursor"];
    if (Object.keys(query).some((key) => !permitted.includes(key)) || Object.values(query).some((v) => typeof v !== "string")) throw new AppError("VALIDATION");
    const c = await caseDetail(getDb(), actor, id);
    const timeline = await caseTimeline(getDb(), actor, id, query.auditCursor ? { cursor: query.auditCursor } : {});
    const reports = await caseReports(getDb(), actor, id, query.reportCursor ? { cursor: query.reportCursor } : {});
    return <><p>{c.targetType} · {c.status} · {c.severity}</p><p className="break-all">{c.targetId}</p>{c.resolutionNote && <p className="whitespace-pre-wrap">{c.resolutionCode}: {c.resolutionNote}</p>}
      <CaseControls caseId={id} targetId={c.targetId} actions={c.availableActions} status={c.status} />
      <section><h2 className="text-xl font-semibold">Báo cáo liên quan</h2><ul>{reports.items.map((r) => <li className="mt-3 rounded-md border p-4" key={r.id}><p>{r.reasonCode} · {r.status} · {r.reporter.displayName}</p><p className="whitespace-pre-wrap">{r.details}</p><p className="break-all">{r.id}</p></li>)}</ul>{nextLink(query, reports.nextCursor, "reportCursor")}</section>
      <section><h2 className="text-xl font-semibold">Audit</h2><ol>{timeline.items.map((a) => <li className="mt-3 rounded-md border p-4" key={a.id}><p>{a.action} · {a.adminDisplay} · {new Date(a.createdAt).toLocaleString("vi-VN")}</p><p className="whitespace-pre-wrap">{a.reasonCode}: {a.reason}</p></li>)}</ol>{nextLink(query, timeline.nextCursor, "auditCursor")}</section></>;
  });
}
export function ReportLink({ type, id }: { type: Target; id: string }) { return <Link className="text-sm underline" href={`/reports/new?targetType=${type}&targetId=${encodeURIComponent(id)}`}>Báo cáo</Link>; }
