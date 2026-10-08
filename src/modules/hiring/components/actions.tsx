"use client";
import { useRef, useState } from "react";
import { Feedback, Field, inputClass, useMutation } from "@/modules/profiles/components/form-parts";
import type { HiringApplication } from "../projection";

export function ApplyButton({ jobId }: { jobId: string }) {
  const key = useRef<string | null>(null); const { busy, message, mutate } = useMutation();
  return <div><button className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => {
    key.current ??= crypto.randomUUID(); void mutate(`jobs/${jobId}/apply`, "POST", { creationKey: key.current }, "/worker/applications");
  }}>Ứng tuyển</button><Feedback message={message} /></div>;
}
export function HiringActions({ application, side, active }: { application: HiringApplication; side: "WORKER" | "EMPLOYER"; active: boolean }) {
  const { busy, message, mutate } = useMutation(); const key = useRef<string | null>(null);
  const [minimum, setMinimum] = useState(""); const [maximum, setMaximum] = useState(""); const [expiry, setExpiry] = useState("");
  const [category, setCategory] = useState("PERSONAL"); const [reason, setReason] = useState("");
  const pre = ["APPLIED", "VIEWED", "SHORTLISTED", "OFFERED"].includes(application.status);
  const offer = application.offer, engagement = application.engagement;
  const buttons: { path: string; label: string; needsActive?: boolean }[] = [];
  const prefix = side === "WORKER" ? "worker-applications" : "employer-applications";
  if (!engagement && pre) {
    if (side === "WORKER") buttons.push({ path: `${prefix}/${application.id}/withdraw`, label: "Rút ứng tuyển" });
    else {
      if (application.status === "APPLIED") buttons.push({ path: `${prefix}/${application.id}/view`, label: "Đánh dấu đã xem", needsActive: true });
      if (["APPLIED", "VIEWED"].includes(application.status)) buttons.push({ path: `${prefix}/${application.id}/shortlist`, label: "Chọn vào danh sách", needsActive: true });
      if (offer?.status !== "PENDING") buttons.push({ path: `${prefix}/${application.id}/reject`, label: "Từ chối ứng viên", needsActive: true });
    }
  }
  if (offer?.status === "PENDING" && !engagement) {
    if (side === "WORKER") buttons.push({ path: `offers/${offer.id}/accept`, label: "Nhận đề nghị", needsActive: true }, { path: `offers/${offer.id}/decline`, label: "Từ chối đề nghị" });
    else buttons.push({ path: `offers/${offer.id}/revoke`, label: "Thu hồi đề nghị" });
  }
  if (engagement) {
    const path = `${side === "WORKER" ? "worker" : "employer"}-engagements/${engagement.id}`;
    if (engagement.status === "ACCEPTED" && side === "EMPLOYER") buttons.push({ path: `${path}/start`, label: "Xác nhận bắt đầu" });
    if (engagement.status === "IN_PROGRESS") {
      if (side === "WORKER" && !engagement.completionRequestedAt) buttons.push({ path: `${path}/request-completion`, label: "Yêu cầu xác nhận hoàn thành" });
      if (side === "EMPLOYER" && engagement.completionRequestedAt) buttons.push({ path: `${path}/confirm-completion`, label: "Xác nhận hoàn thành" });
    }
  }
  return <section className="space-y-5"><div className="flex flex-wrap gap-3">{buttons.map((button) => <button key={button.path} disabled={busy || (button.needsActive && !active)} className="rounded-md border px-4 py-2 disabled:opacity-50" onClick={() => mutate(button.path, "POST", {})}>{button.label}</button>)}</div>
    {side === "EMPLOYER" && active && application.status === "SHORTLISTED" && !engagement && ["PUBLISHED", "PAUSED"].includes(application.job.status) && <form className="space-y-3 rounded-md border p-4" onSubmit={(event) => {
      event.preventDefault(); key.current ??= crypto.randomUUID();
      void mutate(`employer-applications/${application.id}/offers`, "POST", { creationKey: key.current, expiresAt: expiry ? new Date(expiry).toISOString() : null,
        ...(minimum || maximum ? { compensationMin: minimum, compensationMax: maximum } : {}) });
    }}><h2 className="text-xl font-semibold">Gửi đề nghị mới</h2><p>Giữ các điều khoản của tin tại thời điểm gửi. Có thể đề nghị khoảng thu nhập riêng; bản đã gửi được lưu cố định.</p>
      <Field label="Thu nhập tối thiểu (VND, để trống để dùng tin)"><input className={inputClass} inputMode="numeric" pattern="[0-9]+" maxLength={13} value={minimum} onChange={(event) => { setMinimum(event.target.value); key.current = null; }} /></Field>
      <Field label="Thu nhập tối đa (VND)"><input className={inputClass} inputMode="numeric" pattern="[0-9]+" maxLength={13} value={maximum} onChange={(event) => { setMaximum(event.target.value); key.current = null; }} /></Field>
      <Field label="Hết hạn (giờ trên thiết bị, có thể bỏ trống)"><input type="datetime-local" className={inputClass} value={expiry} onChange={(event) => { setExpiry(event.target.value); key.current = null; }} /></Field>
      <button disabled={busy} className="rounded-md border px-4 py-2 disabled:opacity-50">Gửi đề nghị</button></form>}
    {engagement && ["ACCEPTED", "IN_PROGRESS"].includes(engagement.status) && <form className="space-y-3 rounded-md border p-4" onSubmit={(event) => {
      event.preventDefault(); void mutate(`${side === "WORKER" ? "worker" : "employer"}-engagements/${engagement.id}/cancel`, "POST", { category, reason });
    }}><h2 className="text-xl font-semibold">Hủy quan hệ làm việc</h2><p>Lịch sử và điều khoản đã nhận vẫn được lưu.</p><Field label="Nhóm lý do"><select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)}><option value="PERSONAL">Cá nhân</option><option value="SCHEDULE">Lịch làm việc</option><option value="TERMS">Điều khoản</option><option value="OTHER">Khác</option></select></Field>
      <Field label="Lý do"><textarea className={inputClass} required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field><button disabled={busy} className="rounded-md border px-4 py-2 disabled:opacity-50">Xác nhận hủy</button></form>}
    <Feedback message={message} /></section>;
}
