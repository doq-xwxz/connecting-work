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
    ] }))];
  },
};

export default nextConfig;
