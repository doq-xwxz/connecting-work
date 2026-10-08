import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import type { Principal } from "@/modules/auth/policy";
import { MarketplaceNavigation } from "@/modules/profiles/pages";
import { Compensation } from "@/modules/jobs/pages";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { getApplication, listApplications, listOffers } from "./service";
import { HiringActions } from "./components/actions";

type Query = Record<string, string | string[] | undefined>;
async function guarded(title: string, render: (actor: Principal) => Promise<ReactNode>) {
  let content: ReactNode;
  try { content = await render(await requireAuthenticatedUser(await headers())); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <p>Không thể mở hồ sơ ứng tuyển. Kiểm tra vai trò, hồ sơ và quyền truy cập của bạn.</p>;
  }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><MarketplaceNavigation /><h1 className="text-3xl font-semibold">{title}</h1>{content}</main>;
}
export function ApplicationsPage({ side, jobId, query }: { side: "WORKER" | "EMPLOYER"; jobId?: string; query: Query }) {
  return guarded(side === "WORKER" ? "Ứng tuyển của bạn" : "Ứng viên của tin", async (actor) => {
    const page = await listApplications(getDb(), actor, side, query, jobId);
    const root = side === "WORKER" ? "/worker/applications" : "/employer/applications";
    const path = side === "WORKER" ? root : `/employer/jobs/${jobId}/applications`;
    const next = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (typeof value === "string" && key !== "cursor") next.set(key, value);
    if (page.nextCursor) next.set("cursor", page.nextCursor);
    return <><ul className="space-y-4">{page.items.map((application) => <li className="rounded-md border p-4" key={application.id}><Link className="font-semibold underline" href={`${root}/${application.id}`}>{application.job.title}</Link><p>{application.status} · {new Date(application.appliedAt).toLocaleDateString("vi-VN")}</p>
      {application.worker && <p>{application.worker.displayName} · {application.worker.headline} · Hồ sơ {application.worker.completeness.percentage}%</p>}
      <p>Đề nghị: {application.offer?.status ?? "Chưa có"} · Công việc: {application.engagement?.status ?? "Chưa nhận"}</p></li>)}</ul>{!page.items.length && <p>Chưa có hồ sơ trong trang này.</p>}
      {page.nextCursor && <Link className="underline" href={`${path}?${next}`}>Trang tiếp</Link>}</>;
  });
}
export function ApplicationPage({ side, id, query }: { side: "WORKER" | "EMPLOYER"; id: string; query: Query }) {
  return guarded("Chi tiết ứng tuyển", async (actor) => {
    // Sequence transactions sharing the actor lock; avoid self-contention.
    const application = await getApplication(getDb(), actor, side, id);
    const offers = await listOffers(getDb(), actor, side, id, query);
    const engagement = application.engagement;
    return <><h2 className="text-2xl font-semibold">{application.job.title}</h2><p>Ứng tuyển: {application.status} · Tin: {application.job.status}</p>
      {application.worker && <section className="space-y-2"><h2 className="text-xl font-semibold">{application.worker.displayName}</h2><p>{application.worker.headline} · {application.worker.city || "Từ xa"}</p><p>Hồ sơ: {application.worker.completeness.percentage}%</p><ul>{application.worker.skills.map((skill) => <li key={skill.name}>{skill.name}: {skill.level}</li>)}</ul></section>}
      <HiringActions application={application} side={side} active={actor.status === "ACTIVE"} />
      {engagement && <section className="space-y-3 rounded-md border p-4"><h2 className="text-xl font-semibold">Quan hệ làm việc: {engagement.status}</h2><p>{engagement.terms.owner.displayName} · {engagement.terms.worker.displayName}</p><p>{engagement.terms.job.title} · {engagement.terms.job.workMode} · {engagement.terms.job.city || "Từ xa"}</p><Compensation job={engagement.terms.job} /><p>Đã nhận: {engagement.acceptedAt}</p><p>Yêu cầu hoàn thành: {engagement.completionRequestedAt ?? "Chưa yêu cầu"}</p><p>{engagement.cancellationReason}</p></section>}
      <section className="space-y-4"><h2 className="text-xl font-semibold">Lịch sử đề nghị</h2>{offers.items.map((offer) => <article key={offer.id} className="space-y-2 rounded-md border p-4"><h3 className="font-semibold">Lần {offer.revision} · {offer.status}</h3><p>{offer.terms.owner.displayName} · {offer.terms.job.title}</p><Compensation job={offer.terms.job} /><p>{offer.terms.job.employmentType} · {offer.terms.job.workMode} · {offer.terms.job.city || "Từ xa"}</p><p>{offer.terms.job.startDate ?? "Chưa có ngày bắt đầu"} → {offer.terms.job.endDate ?? "Chưa có ngày kết thúc"} · {offer.terms.job.timezone}</p><ul>{offer.terms.job.schedule.map((slot) => <li key={`${slot.weekday}-${slot.startHour}`}>Ngày tuần {slot.weekday}: {slot.startHour}:00–{slot.endHour}:00</li>)}</ul><p>Hết hạn: {offer.expiresAt ?? "Không đặt hạn"}</p></article>)}
        {offers.nextCursor && <Link className="underline" href={`?cursor=${offers.nextCursor}`}>Các đề nghị tiếp theo</Link>}</section></>;
  });
}
