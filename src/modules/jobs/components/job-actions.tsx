"use client";
import { useRef } from "react";
import { Feedback, useMutation } from "@/modules/profiles/components/form-parts";
import { type JobAction, type ManagedJob } from "../contracts";
export function JobActions({ job, active }: { job: ManagedJob; active: boolean }) {
  const { busy, message, mutate } = useMutation(); const duplicateKey = useRef<string | null>(null);
  const available: { action: JobAction; label: string; exposure: boolean }[] = [];
  if (job.status === "DRAFT") available.push({ action: "publish", label: "Đăng tin", exposure: true });
  if (job.status === "PUBLISHED") available.push({ action: "pause", label: "Tạm dừng", exposure: false });
  if (job.status === "PAUSED") available.push({ action: "resume", label: "Tiếp tục đăng", exposure: true });
  if (["PUBLISHED", "PAUSED"].includes(job.status)) available.push({ action: "close", label: "Kết thúc tuyển", exposure: false });
  if (["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"].includes(job.status)) available.push({ action: "cancel", label: "Hủy tin", exposure: false });
  if (job.status === "CLOSED") available.push({ action: "complete", label: "Hoàn thành tin", exposure: false });
  return <div className="my-6 space-y-3"><div className="flex flex-wrap gap-3">{available.map(({ action, label, exposure }) =>
    <button key={action} className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={busy || (exposure && !active)}
      onClick={() => mutate(`employer-jobs/${job.id}/${action}`, "POST", { expectedVersion: job.version })}>{label}</button>)}
    <button className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={busy || !active} onClick={() => {
      duplicateKey.current ??= crypto.randomUUID(); void mutate(`employer-jobs/${job.id}/duplicate`, "POST", { creationKey: duplicateKey.current }, "/employer/jobs");
    }}>Nhân bản thành nháp mới</button></div><Feedback message={message} /></div>;
}
