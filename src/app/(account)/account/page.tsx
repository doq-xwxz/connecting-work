import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { AccountControls } from "@/modules/auth/components/account-controls";
import { AppError } from "@/shared/errors/app-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page() {
  let user;
  try { user = await requireAuthenticatedUser(await headers()); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-2xl font-semibold">Tài khoản chưa sẵn sàng</h1><p className="mt-4">Vui lòng thử lại sau.</p><Link className="mt-4 block underline" href="/sign-in">Đăng nhập</Link></main>;
  }
  return <main className="mx-auto max-w-xl px-6 py-16">
    <Link href="/" className="text-sm tracking-widest">CONNECTING WORK</Link>
    <h1 className="mt-6 text-3xl font-semibold">Tài khoản của bạn</h1>
    <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 break-words">
      <dt>Họ tên</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd>
      <dt>Xác minh</dt><dd>{user.emailVerified ? "Đã xác minh email" : "Chưa xác minh email"}</dd>
      <dt>Vai trò</dt><dd>{user.roles.join(", ") || "Chưa bật vai trò"}</dd><dt>Trạng thái</dt><dd>{user.status}</dd>
    </dl>
    <AccountControls roles={user.roles} active={user.status === "ACTIVE"} />
    <Link className="mt-4 block underline" href="/account/reports">Báo cáo của tôi</Link>
    {user.roles.includes("ADMIN") && user.status === "ACTIVE" && <Link className="mt-4 block underline" href="/admin/cases">Moderation</Link>}
  </main>;
}
