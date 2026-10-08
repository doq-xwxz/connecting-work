import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { MarketplaceNavigation } from "@/modules/profiles/pages";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { recommendedCandidates, recommendedJobs } from "./service";
import type { MatchResult } from "./algorithm";

const labels = { skills: "Kỹ năng", availability: "Thời gian", location: "Khu vực / hình thức", compensation: "Thu nhập", experience: "Kinh nghiệm", rating: "Đánh giá", reliability: "Lịch sử hoàn thành / phản hồi" };
export function MatchExplanation({ match }: { match: MatchResult }) {
  return <section className="mt-3 space-y-2" aria-label="Giải thích mức độ phù hợp"><p className="font-semibold">Mức độ phù hợp: {match.score ?? "Chưa tính"}/100 · Coverage: {match.coverage}%</p>
    <p className="text-sm">Điểm được chuẩn hóa trên dữ liệu đo được. Coverage thấp nghĩa là còn thiếu dữ liệu; điểm không phải xác suất được tuyển.</p>
    <details><summary className="cursor-pointer underline">Xem các thành phần</summary><ul>{match.components.map((item) => <li key={item.key}>{labels[item.key]} ({item.weight}%): {item.covered ? `${item.score}/100 · đóng góp ${item.weightedContribution}` : "Chưa đo được"}</li>)}</ul>
      <p className="text-sm">{match.weightsVersion} · {match.algorithmVersion}</p></details></section>;
}
export async function RecommendationsPage({ jobId, query }: { jobId?: string; query: Record<string, string | string[] | undefined> }) {
  let content: ReactNode;
  try {
    const actor = await requireAuthenticatedUser(await headers());
    const page = jobId ? await recommendedCandidates(getDb(), actor, jobId, query) : await recommendedJobs(getDb(), actor, query);
    content = <>{"profileCompleteness" in page && <p>Hồ sơ của bạn: {page.profileCompleteness.percentage}% hoàn thiện.</p>}
      <p>Xếp hạng trong tối đa {page.candidatePoolLimit} {jobId ? "hồ sơ đã bật tìm kiếm" : "tin đang đăng"}, chọn theo ID ổn định. Đây là tập gợi ý giới hạn; tìm kiếm công khai vẫn hiển thị các tin khác.</p>
      {!page.items.length && <p className="mt-4">Chưa có gợi ý đủ điều kiện trong tập hiện tại. Kiểm tra hồ sơ, bộ lọc hoặc quay lại sau.</p>}
      <ul className="mt-5 space-y-4">{page.items.map((item) => <li key={item.id} className="rounded-md border p-4">{"title" in item
        ? <Link className="text-xl underline" href={`/jobs/${item.id}`}>{item.title}</Link>
        : <><h2 className="text-xl">{item.displayName}</h2><p>{item.headline} · {item.city || "Từ xa"}</p><p>Hồ sơ: {item.profileCompleteness.percentage}%</p><p>{item.skills.map((skill) => `${skill.name} (${skill.level})`).join(", ")}</p></>}
        <MatchExplanation match={item.match} /></li>)}</ul>
      {page.nextCursor && <Link className="mt-5 block underline" href={`?cursor=${encodeURIComponent(page.nextCursor)}&limit=${typeof query.limit === "string" ? encodeURIComponent(query.limit) : 12}`}>Trang tiếp</Link>}</>;
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <p>Không thể tải gợi ý. Kiểm tra vai trò, hồ sơ, trạng thái tin và quyền quản lý.</p>;
  }
  return <main className="mx-auto max-w-3xl space-y-5 px-6 py-12"><MarketplaceNavigation /><h1 className="text-3xl font-semibold">{jobId ? "Người phù hợp với tin" : "Việc làm phù hợp với bạn"}</h1>{content}</main>;
}
