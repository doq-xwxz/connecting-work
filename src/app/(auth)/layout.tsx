import Link from "next/link";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center gap-6 px-6 py-12"><Link href="/" className="text-sm tracking-widest">CONNECTING WORK</Link>{children}</main>;
}
