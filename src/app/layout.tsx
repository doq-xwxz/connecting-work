import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connecting Work",
  description: "Nền tảng dự án Connecting Work. Sản phẩm đang được phát triển.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
