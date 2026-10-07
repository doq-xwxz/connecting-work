import { getAuth, getAuthConfig } from "@/modules/auth/server";
import { handleAuthRequest } from "@/modules/auth/http";
import { getAuthEmailSender } from "@/shared/email/sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const { origin } = getAuthConfig();
    return await handleAuthRequest(request, { origin, getAuth, assertEmailReady: getAuthEmailSender });
  } catch {
    return Response.json({ message: "Xác thực chưa sẵn sàng. Vui lòng thử lại sau." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
export { handle as GET, handle as POST };
