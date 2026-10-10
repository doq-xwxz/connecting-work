export function securityHeaders(env: Record<string, string | undefined>) {
  const production = env.NODE_ENV === "production";
  const csp = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self'${production ? "" : " ws: wss:"}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
  // Explicit operational opt-in; a build may be reused on local HTTP/preview.
  if (production && env.ENABLE_HSTS === "1" && env.APP_URL?.startsWith("https://")) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}
