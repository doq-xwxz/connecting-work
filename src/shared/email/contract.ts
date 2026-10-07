export type AuthEmail = { to: string; kind: "verification" | "password-reset"; url: string };
export interface AuthEmailSender { send(message: AuthEmail): Promise<void> }

export function createResendSender(apiKey: string, from: string, send: typeof fetch = fetch): AuthEmailSender {
  return {
    async send(message) {
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [message.to],
          subject: message.kind === "verification" ? "Xác minh email Connecting Work" : "Đặt lại mật khẩu Connecting Work",
          text: `${message.kind === "verification" ? "Xác minh email" : "Đặt lại mật khẩu"}: ${message.url}\nNếu bạn không yêu cầu, hãy bỏ qua email này.` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Auth email delivery failed.");
      // Do not read/log provider bodies, recipient addresses or token URLs.
    },
  };
}
