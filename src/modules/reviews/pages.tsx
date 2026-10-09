import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { MarketplaceNavigation } from "@/modules/profiles/pages";
import type { reputationDto } from "./contracts";
import { workerReviewsForEmployer, ownerReviewsForJob } from "./service";
import { ReportLink } from "@/modules/moderation/pages";

export function ReputationSummary({ reputation }: { reputation: ReturnType<typeof reputationDto> }) {
  return <section aria-label="Uy tín" className="space-y-1"><p>Đánh giá: {reputation.rating.average?.toFixed(1) ?? "Chưa có"} / 5 · {reputation.rating.count} đánh giá</p>
    <p>Lịch sử: {reputation.reliability.completed} hoàn thành · {reputation.reliability.relevantCancelled} hủy bởi người lao động · Mẫu {reputation.reliability.sampleSize}
      {reputation.reliability.score !== null && ` · Tỷ lệ ${(reputation.reliability.score * 100).toFixed(1)}%`}</p><p className="text-sm">Số liệu theo lịch sử ghi nhận; mẫu ít chưa thể hiện toàn bộ kinh nghiệm.</p></section>;
}
export function ReviewList({ items }: { items: Awaited<ReturnType<typeof ownerReviewsForJob>>["items"] }) {
  return <ul className="space-y-3">{items.map((review) => <li className="rounded-md border p-4" key={review.id}><p>{review.rating} / 5 · {review.reviewerDisplay}</p><p>{review.targetDisplay} · {review.jobTitle}</p>
    <p>Hoàn thành: {review.completedAt ? new Date(review.completedAt).toLocaleDateString("vi-VN") : "Đã xác nhận"}</p><p className="whitespace-pre-wrap">{review.comment}</p><p>{new Date(review.createdAt).toLocaleDateString("vi-VN")}</p><ReportLink type="REVIEW" id={review.id} /></li>)}</ul>;
}
export async function ReviewsPage({ workerId, jobId, query }: { workerId?: string; jobId?: string; query: Record<string, string | string[] | undefined> }) {
  try {
    const actor = await requireAuthenticatedUser(await headers());
    const workerPage = workerId ? await workerReviewsForEmployer(getDb(), actor, workerId, query) : null;
    const page = workerPage ?? await ownerReviewsForJob(getDb(), actor, jobId!, query);
    return <main className="mx-auto max-w-3xl space-y-5 px-6 py-12"><MarketplaceNavigation /><h1 className="text-3xl font-semibold">Đánh giá từ công việc đã hoàn thành</h1>
      {workerPage && <ReputationSummary reputation={workerPage.reputation} />}<ReviewList items={page.items} />{!page.items.length && <p>Chưa có đánh giá hiển thị.</p>}
      {page.nextCursor && <Link className="underline" href={`?cursor=${page.nextCursor}`}>Trang tiếp</Link>}</main>;
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    return <main className="mx-auto max-w-3xl px-6 py-12"><h1>Không thể mở đánh giá</h1><p>Kiểm tra vai trò, trạng thái và quyền xem hồ sơ.</p></main>;
  }
}
