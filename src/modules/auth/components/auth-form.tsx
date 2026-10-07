"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Mode = "sign-in" | "sign-up" | "verify-email" | "forgot-password" | "reset-password";
const titles: Record<Mode, string> = {
  "sign-in": "Đăng nhập", "sign-up": "Tạo tài khoản", "verify-email": "Xác minh email",
  "forgot-password": "Quên mật khẩu", "reset-password": "Đặt lại mật khẩu",
};
const inputClass = "w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AuthForm({ mode }: { mode: Mode }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const initializedTokenMode = useRef<Mode | null>(null);
  useEffect(() => {
    if (mode === "verify-email" || mode === "reset-password") {
      if (initializedTokenMode.current === mode) return;
      initializedTokenMode.current = mode;
      // Fragment never travels in HTTP URL/referrer or server access logs.
      setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const resend = mode === "verify-email" && !token;
    const path = mode === "sign-in" ? "sign-in/email" : mode === "sign-up" ? "sign-up/email" :
      mode === "forgot-password" ? "request-password-reset" : mode === "reset-password" ? "reset-password" :
      resend ? "send-verification-email" : "verify-email";
    const body = mode === "sign-in" ? { email, password, callbackURL: "/account" } :
      mode === "sign-up" ? { email, password, name: String(form.get("name") ?? ""), callbackURL: "/account" } :
      mode === "forgot-password" ? { email, redirectTo: "/reset-password" } :
      mode === "reset-password" ? { token, newPassword: password } : resend ? { email, callbackURL: "/account" } : { token };
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        setFailed(true);
        setMessage(response.status === 429 ? "Bạn thao tác quá nhanh. Vui lòng thử lại sau." :
          response.status >= 500 ? "Dịch vụ xác thực chưa sẵn sàng. Vui lòng thử lại sau." :
          mode === "sign-in" ? "Không thể đăng nhập. Kiểm tra thông tin và xác minh email trước khi thử lại." :
          "Không thể hoàn tất. Kiểm tra dữ liệu hoặc yêu cầu liên kết mới.");
        return;
      }
      if (mode === "sign-in") { window.location.assign("/account"); return; }
      if (mode === "reset-password") { setToken(""); setMessage("Đã đổi mật khẩu. Vui lòng đăng nhập lại."); }
      else if (mode === "verify-email" && token) { setToken(""); setMessage("Email đã được xác minh. Bạn có thể đăng nhập."); }
      else setMessage("Nếu địa chỉ email đủ điều kiện, bạn sẽ nhận được hướng dẫn. Kiểm tra cả thư mục spam.");
    } catch { setFailed(true); setMessage("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }

  const needsEmail = ["sign-in", "sign-up", "forgot-password"].includes(mode) || (mode === "verify-email" && !token);
  const needsPassword = ["sign-in", "sign-up", "reset-password"].includes(mode);
  return (
    <section className="w-full max-w-md rounded-xl border bg-card p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">{titles[mode]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Connecting Work · Tài khoản chung cho người tìm việc và người thuê.</p>
      {mode === "verify-email" && <p className="mt-4 text-sm">{token ? "Nhấn xác nhận để xác minh email của bạn." : "Nhập email để yêu cầu liên kết xác minh mới."}</p>}
      {mode === "reset-password" && !token && <p className="mt-4 text-sm">Mở liên kết trong email đặt lại mật khẩu. Nếu liên kết đã hết hạn, hãy yêu cầu liên kết mới.</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === "sign-up" && <label className="block space-y-1"><span>Họ tên</span><input className={inputClass} name="name" autoComplete="name" required maxLength={100} /></label>}
        {needsEmail && <label className="block space-y-1"><span>Email</span><input className={inputClass} name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
        {needsPassword && <label className="block space-y-1"><span>Mật khẩu{mode !== "sign-in" ? " (12–128 ký tự)" : ""}</span><input className={inputClass} name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-in" ? 1 : 12} maxLength={128} /></label>}
        <button className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50" disabled={busy || (mode === "reset-password" && !token)}>
          {busy ? "Đang xử lý…" : mode === "verify-email" ? token ? "Xác nhận email" : "Gửi lại liên kết" : titles[mode]}
        </button>
      </form>
      <p aria-live="polite" role={failed ? "alert" : "status"} className="mt-4 text-sm">{message}</p>
      <nav aria-label="Tài khoản" className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm underline underline-offset-4">
        <Link href="/sign-in">Đăng nhập</Link><Link href="/sign-up">Tạo tài khoản</Link>
        <Link href="/forgot-password">Quên mật khẩu</Link><Link href="/verify-email">Xác minh email</Link>
      </nav>
    </section>
  );
}
