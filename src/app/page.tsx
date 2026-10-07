import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium tracking-widest text-muted-foreground">CONNECTING WORK</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Tìm đúng việc.<br />Gặp đúng người.</h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
        Dự án đang ở giai đoạn xây dựng nền tảng kỹ thuật. Các chức năng tìm việc và tuyển người chưa được mở.
      </p>
      <div className="w-fit rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground">
        Phase 2 · Nền tảng tài khoản
      </div>
      <nav className="flex gap-4" aria-label="Tài khoản"><Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/sign-up">Tạo tài khoản</Link><Link className="rounded-md border px-4 py-2" href="/sign-in">Đăng nhập</Link></nav>
    </main>
  );
}
