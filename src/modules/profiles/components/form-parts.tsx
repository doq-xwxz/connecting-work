"use client";
import { useState } from "react";
import type { ReactNode } from "react";

export const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}</label>;
}
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function mutate(path: string, method: string, body: object, destination?: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/marketplace/${path}`, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setMessage("Không thể lưu. Kiểm tra dữ liệu và quyền truy cập, rồi thử lại."); return; }
      if (destination) window.location.assign(destination);
      else window.location.reload();
    } catch { setMessage("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return { busy, message, mutate };
}
export function Feedback({ message }: { message: string }) { return <p role="status" aria-live="polite" className="text-sm">{message}</p>; }
