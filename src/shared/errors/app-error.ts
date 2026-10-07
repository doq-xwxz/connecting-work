export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const PUBLIC_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: "Dữ liệu không hợp lệ.",
  UNAUTHENTICATED: "Vui lòng đăng nhập.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  NOT_FOUND: "Không tìm thấy dữ liệu.",
  CONFLICT: "Dữ liệu đã thay đổi. Vui lòng thử lại.",
  RATE_LIMITED: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
  INTERNAL: "Đã xảy ra lỗi. Vui lòng thử lại sau.",
};

export class AppError extends Error {
  constructor(readonly code: ErrorCode, options?: ErrorOptions) {
    super(PUBLIC_MESSAGES[code], options);
    this.name = "AppError";
  }
}

// Explicit allowlist. Never serialize an Error, cause, stack or arbitrary message.
export function toClientError(error: unknown, requestId: string) {
  const code = error instanceof AppError ? error.code : "INTERNAL";
  return { code, status: ERROR_STATUS[code], message: PUBLIC_MESSAGES[code], requestId };
}
