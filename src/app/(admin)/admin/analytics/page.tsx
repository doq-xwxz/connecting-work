import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { adminAnalytics } from "@/modules/analytics/service";
import { defaultRange } from "@/modules/analytics/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let data: Awaited<ReturnType<typeof adminAnalytics>>;
  try {
    const actor = await requireAuthenticatedUser(await headers());
    const query = await searchParams;
    data = await adminAnalytics(getDb(), actor, Object.keys(query).length ? query : defaultRange());
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl">Analytics</h1><p role="alert">Không thể xem dữ liệu. Kiểm tra quyền ADMIN đang hoạt động và khoảng thời gian UTC tối đa 366 ngày.</p></main>;
  }
  const percent = (value: number | null) => value === null ? "Chưa có dữ liệu" : `${value}%`;
  const funnel = data.applicationCohort;
  return <main className="mx-auto max-w-4xl space-y-6 p-6">
    <nav className="flex gap-4 underline"><Link href="/admin/cases">Cases</Link><Link href="/admin/reports">Báo cáo</Link></nav>
    <h1 className="text-3xl font-semibold">Analytics marketplace</h1>
    <form className="grid gap-3 sm:grid-cols-2"><label>Từ (UTC, ISO 8601)<input className="block w-full rounded border p-2" name="start" required defaultValue={data.range.start} /></label>
      <label>Đến, không bao gồm (UTC, ISO 8601)<input className="block w-full rounded border p-2" name="end" required defaultValue={data.range.end} /></label><button className="rounded border p-2">Xem dữ liệu</button></form>
    <p>Thời điểm dữ liệu: {data.asOf}. Khoảng [từ, đến), tối đa 366 ngày.</p>
    <section className="space-y-2 rounded border p-4"><h2 className="text-xl font-semibold">North Star — Engagement đã hoàn thành</h2>
      <p>Tổng: {data.activity.completedTotal} · Thông thường: {data.activity.completedOrganic} · Admin cưỡng chế: {data.activity.completedForced}</p><p>Tính theo thời điểm hoàn thành trong khoảng đã chọn.</p></section>
    <section className="space-y-2 rounded border p-4"><h2 className="text-xl font-semibold">Liquidity 3/24h</h2><p>{percent(data.liquidity.rate.percent)} · Mục tiêu: 50%</p>
      <p>{data.liquidity.jobsWith3RelevantApplicants24h} / {data.liquidity.jobsEligibleFor24hLiquidity} tin đủ tuổi quan sát 24h có ít nhất 3 đơn phù hợp trong 24h đầu.</p>
      <p>Đăng lần đầu trong khoảng đã chọn. Loại {data.liquidity.excludedEarlyCancelledJobs} tin hủy trong 5 phút đầu và không có đơn. Tin đóng, tạm dừng và bị ẩn vẫn được tính. Dùng điểm chụp lúc ứng tuyển.</p></section>
    <section><h2 className="text-xl font-semibold">Hoạt động trong khoảng</h2><p>Tin đăng lần đầu: {data.activity.publishedJobs} · Đơn ứng tuyển: {data.activity.applications} · Offer được chấp nhận: {data.activity.acceptedOffers} · Engagement mới: {data.activity.engagementsCreated}</p></section>
    <section><h2 className="text-xl font-semibold">Funnel theo cohort đơn ứng tuyển</h2><p>Đơn được tạo trong khoảng; các bước tiếp theo quan sát đến thời điểm dữ liệu. Cohort mới có thể chưa hoàn tất.</p>
      <p>Hoàn thành: {funnel.completedOrganic} thông thường, {funnel.completedForced} admin cưỡng chế. Hủy: {funnel.cancelledParticipant} do các bên, {funnel.cancelledForced} admin cưỡng chế. Tỷ lệ kết thúc bên dưới tính cả hai nguồn.</p>
      <table className="w-full text-left"><caption className="sr-only">Số lượng và tỷ lệ theo cùng cohort đơn ứng tuyển</caption><thead><tr><th scope="col">Bước</th><th scope="col">Số lượng</th><th scope="col">Tỷ lệ</th></tr></thead>
        <tbody>{[["Ứng tuyển", funnel.applications, null], ["Đã shortlist trực tiếp", funnel.shortlisted, funnel.shortlistRate.percent], ["Có ít nhất một Offer", funnel.offered, funnel.offerRate.percent], ["Chấp nhận / có Offer", funnel.accepted, funnel.acceptanceRate.percent], ["Bắt đầu / chấp nhận", funnel.started, funnel.startRate.percent], ["Hoàn thành / đã kết thúc", funnel.completed, funnel.completionRate.percent], ["Hủy", funnel.cancelled, null]].map(([label, count, rate]) => <tr key={String(label)}><th scope="row">{label}</th><td>{count}</td><td>{rate === null ? "—" : percent(Number(rate))}</td></tr>)}</tbody>
      </table></section>
  </main>;
}
