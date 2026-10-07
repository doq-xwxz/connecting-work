import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium tracking-widest text-muted-foreground">CONNECTING WORK</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Tìm đúng việc.<br />Gặp đúng người.</h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
        Tạo hồ sơ, đăng tin tuyển dụng cá nhân hoặc công ty và xem các tin đang đăng. Quy trình ứng tuyển và tuyển người chưa được mở.
      </p>
      <div className="w-fit rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground">
        Phase 4 · Tin tuyển dụng
      </div>
      <nav className="flex flex-wrap gap-4" aria-label="Tài khoản"><Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/jobs">Xem việc làm</Link><Link className="rounded-md border px-4 py-2" href="/sign-up">Tạo tài khoản</Link><Link className="rounded-md border px-4 py-2" href="/sign-in">Đăng nhập</Link></nav>
    </main>
  );
}
