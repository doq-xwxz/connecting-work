import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/security/headers";

const nextConfig: NextConfig = {
  // Governance is maintained explicitly in AGENTS.md.
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }, ...["/verify-email", "/reset-password", "/account/:path*", "/admin/:path*", "/reports/:path*", "/notifications", "/worker/:path*", "/employer/:path*", "/api/auth/:path*", "/api/account/:path*", "/api/admin/:path*", "/api/marketplace/:path*"].map((source) => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] })), ...["/sign-in", "/sign-up", "/forgot-password"].map((source) => ({ source, headers: [
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }))];
  },
};

export default nextConfig;
