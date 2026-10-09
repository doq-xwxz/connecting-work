"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { reasons, severities, targets, type ModerationAction, type Target } from "../contracts";

const inputClass = "mt-1 w-full rounded-md border p-2";
export function ReportForm({ targetType, targetId, context }: { targetType: Target; targetId?: string; context?: { applicationId: string; side: "WORKER" | "EMPLOYER" } }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const endpoint = context ? `/api/marketplace/${context.side === "WORKER" ? "worker" : "employer"}-applications/${context.applicationId}/report-counterparty` : "/api/marketplace/reports";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(context ? {} : { targetType, targetId }), reasonCode: data.get("reasonCode"), details: data.get("details") || null }) });
      if (!response.ok) { setMessage(response.status === 429 ? "Bạn đã đạt giới hạn báo cáo. Vui lòng thử lại sau." : "Không thể gửi báo cáo. Kiểm tra nội dung và quyền truy cập."); return; }
      setMessage("Đã tiếp nhận báo cáo. Bạn có thể xem trạng thái trong báo cáo của mình.");
    } catch { setMessage("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4"><label className="block">Lý do<select name="reasonCode" className={inputClass}>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
    <label className="block">Chi tiết (bắt buộc nếu chọn OTHER)<textarea name="details" maxLength={2000} rows={5} className={inputClass} /></label>
    <p className="text-sm">Không gửi mật khẩu, mã xác thực hoặc thông tin riêng tư không cần thiết.</p>
    <button disabled={busy} className="rounded-md border px-4 py-2">{busy ? "Đang gửi…" : "Gửi báo cáo"}</button><p role="status">{message}</p></form>;
}
type CaseSeed = { targetType: Target; targetId: string; reportId?: string };
export function CreateCaseForm({ seed }: { seed?: CaseSeed }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const f = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: f.get("targetType"), targetId: f.get("targetId"), severity: f.get("severity"), reason: f.get("reason"), reasonCode: f.get("reasonCode"), ...(seed?.reportId ? { reportId: seed.reportId } : {}) }) });
      if (!response.ok) { setMessage("Không thể tạo case. Kiểm tra quyền và đối tượng."); return; }
      const result: { id: string } = await response.json(); router.push(`/admin/cases/${encodeURIComponent(result.id)}`); router.refresh();
    } catch { setMessage("Không thể kết nối."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded-md border p-4"><h2 className="text-xl font-semibold">Mở case</h2>
    <label className="block">Loại đối tượng<select name="targetType" defaultValue={seed?.targetType ?? "JOB"} className={inputClass}>{targets.map((t) => <option key={t}>{t}</option>)}</select></label>
    <label className="block">ID đối tượng<input name="targetId" required maxLength={128} defaultValue={seed?.targetId} className={inputClass} /></label>
    <label className="block">Mức ưu tiên<select name="severity" className={inputClass}>{severities.map((s) => <option key={s}>{s}</option>)}</select></label>
    <ReasonFields /><button disabled={busy} className="rounded-md border px-4 py-2">Mở case</button><p role="status">{message}</p></form>;
}
function ReasonFields() { return <><label className="block">Mã lý do<select name="reasonCode" className={inputClass}>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label><label className="block">Lý do xử lý<textarea name="reason" required maxLength={2000} rows={3} className={inputClass} /></label></>; }
const actionLabels: Record<ModerationAction, string> = { "hide-job": "Ẩn tin", "unhide-job": "Bỏ ẩn tin", "hide-review": "Ẩn đánh giá", "unhide-review": "Bỏ ẩn đánh giá", suspend: "Tạm hạn chế tài khoản", unsuspend: "Gỡ tạm hạn chế", ban: "Cấm tài khoản", "force-complete": "Xác nhận hoàn thành theo case", "force-cancel": "Hủy công việc theo case" };
export function CaseControls({ caseId, targetId, actions, status }: { caseId: string; targetId: string; actions: ModerationAction[]; status: string }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [context, setContext] = useState<Record<string, unknown> | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const f = new FormData(event.currentTarget), action = String(f.get("command"));
    const endpoint = actions.includes(action as ModerationAction) ? `actions/${action}` : action;
    const body = { reason: f.get("reason"), reasonCode: f.get("reasonCode"),
      ...(actions.includes(action as ModerationAction) ? { targetId } : {}), ...(action === "close" ? { resolutionCode: f.get("resolutionCode") } : {}), ...(action === "reports" ? { reportId: f.get("reportId") } : {}) };
    try {
      const response = await fetch(`/api/admin/cases/${caseId}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setMessage("Thao tác bị từ chối. Kiểm tra trạng thái, quyền và đối tượng của case."); return; }
      if (action === "context") setContext(await response.json());
      else router.refresh();
      setMessage("Đã ghi nhận thao tác và audit.");
    } catch { setMessage("Không thể kết nối."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4"><form onSubmit={submit} className="space-y-3 rounded-md border p-4"><h2 className="text-xl font-semibold">Thao tác theo case</h2>
    <ReasonFields /><label className="block">Thao tác<select name="command" className={inputClass}><option value="context">Xem đối tượng (ghi audit)</option>
      {status === "OPEN" && <option value="investigate">Bắt đầu điều tra</option>}{status !== "CLOSED" && <><option value="reports">Gắn báo cáo cùng đối tượng</option><option value="close">Đóng case</option></>}
      {actions.map((a) => <option value={a} key={a}>{actionLabels[a]}</option>)}</select></label>
    {status !== "CLOSED" && <><label className="block">ID báo cáo (khi gắn báo cáo)<input name="reportId" maxLength={36} className={inputClass} /></label>
      <label className="block">Kết luận (khi đóng case)<select name="resolutionCode" className={inputClass}><option>RESOLVED</option><option>DISMISSED</option></select></label></>}
    <button disabled={busy} className="rounded-md border px-4 py-2">Thực hiện</button><p role="status">{message}</p></form>
    {context && <section aria-label="Đối tượng điều tra" className="rounded-md border p-4"><h2 className="text-xl font-semibold">Đối tượng của case</h2><dl>{Object.entries(context).map(([key, value]) => <div key={key} className="mt-2"><dt className="font-semibold">{key}</dt><dd className="whitespace-pre-wrap break-words">{value === null ? "—" : String(value)}</dd></div>)}</dl></section>}</section>;
}
