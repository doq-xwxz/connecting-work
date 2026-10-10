import type { MetadataRoute } from "next";

// Crawling policy only. Services still authorize every private request.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/", "/jobs"], disallow: [
    "/api/", "/account", "/admin", "/worker", "/employer", "/reports",
    "/notifications", "/sign-in", "/sign-up", "/forgot-password",
    "/verify-email", "/reset-password",
  ] } };
}
