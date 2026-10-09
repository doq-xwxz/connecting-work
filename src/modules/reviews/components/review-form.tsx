"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewForm({ side, engagementId }: { side: "WORKER" | "EMPLOYER"; engagementId: string }) {
  const router = useRouter(), key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  return <form className="space-y-3 rounded-md border p-4" onSubmit={async (event) => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    key.current ??= crypto.randomUUID(); setBusy(true); setFeedback("");
    try {
      const response = await fetch(`/api/marketplace/${side === "WORKER" ? "worker" : "employer"}-engagements/${engagementId}/reviews`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: Number(data.get("rating")), comment: String(data.get("comment") ?? ""), creationKey: key.current }) });
      if (!response.ok) { setFeedback(response.status === 409 ? "Đánh giá đã được gửi hoặc dữ liệu lần gửi lại đã thay đổi." : "Không thể gửi. Kiểm tra quyền, điểm và nội dung rồi thử lại."); return; }
      setFeedback("Đã gửi đánh giá."); router.refresh();
    } catch { setFeedback("Chưa xác nhận được kết quả. Giữ nguyên nội dung để thử lại."); }
    finally { setBusy(false); }
  }}>
    <h3 className="font-semibold">{side === "WORKER" ? "Đánh giá người thuê" : "Đánh giá người lao động"}</h3>
    <p>Chỉ gửi một lần sau khi hoàn thành. Đánh giá đã gửi không thể sửa hoặc xóa.</p>
    <label className="block">Điểm<select name="rating" required disabled={busy} className="ml-3 rounded-md border p-2" defaultValue=""><option value="" disabled>Chọn điểm</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>
    <label className="block">Nhận xét (không bắt buộc)<textarea name="comment" maxLength={2000} disabled={busy} className="mt-1 w-full rounded-md border p-2" /></label>
    <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{busy ? "Đang gửi…" : "Gửi đánh giá"}</button><p role="status">{feedback}</p>
  </form>;
}
