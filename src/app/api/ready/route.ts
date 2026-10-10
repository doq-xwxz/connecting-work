import { getDb } from "@/shared/db/client";
import { measured } from "@/shared/observability/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await measured("readiness", () => Promise.race([getDb().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      await tx.$queryRaw`SELECT 1`;
    }, { maxWait: 1500, timeout: 2000 }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Unavailable")), 2500); })]));
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  finally { if (timer) clearTimeout(timer); }
}
