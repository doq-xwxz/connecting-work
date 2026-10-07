"use client";
import { useState } from "react";
import Link from "next/link";

export function AccountControls({ roles, active }: { roles: string[]; active: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function mutate(path: string, body: object) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setMessage("Không thể hoàn tất thao tác. Vui lòng thử lại."); return; }
      if (path.endsWith("sign-out")) window.location.assign("/sign-in");
      else window.location.reload();
    } catch { setMessage("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <div className="mt-6 space-y-4">
    <p className="text-sm text-muted-foreground">Bạn có thể bật cả hai vai trò và tạo hồ sơ riêng cho từng vai trò.</p>
    <div className="flex flex-wrap gap-3">{(["WORKER", "EMPLOYER"] as const).map((role) => <button key={role}
      className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={busy || !active || roles.includes(role)}
      onClick={() => mutate("/api/account/roles", { role })}>{roles.includes(role) ? "Đã bật: " : "Bật: "}{role === "WORKER" ? "Người tìm việc" : "Người thuê"}</button>)}</div>
    {!active && <p className="text-sm">Tài khoản hiện không được tạo hoạt động mới. Quyền truy cập tài khoản không đồng nghĩa với quyền thực hiện nghiệp vụ.</p>}
    <nav aria-label="Hồ sơ theo vai trò" className="flex flex-wrap gap-4 underline">
      {roles.includes("WORKER") && <Link href="/worker/profile">Hồ sơ tìm việc</Link>}
      {roles.includes("EMPLOYER") && <><Link href="/employer/profile">Hồ sơ người thuê</Link><Link href="/employer/companies">Công ty</Link><Link href="/employer/workers">Tìm người</Link></>}
    </nav>
    <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={() => mutate("/api/auth/sign-out", {})}>Đăng xuất</button>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>;
}
