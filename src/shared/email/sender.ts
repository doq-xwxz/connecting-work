import "server-only";
import { createResendSender } from "./contract";

export function getAuthEmailSender() {
  if (process.env.EMAIL_PROVIDER !== "resend" || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    throw new Error("Auth email provider is not configured.");
  }
  return createResendSender(process.env.RESEND_API_KEY, process.env.EMAIL_FROM);
}
