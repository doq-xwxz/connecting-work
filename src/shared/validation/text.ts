import { z } from "zod";

// Plain text, not HTML sanitization. Empty drafts remain allowed; invisible-only
// input does not count as content. Keep valid Vietnamese and normal line breaks.
export const validPlainText = (value: string) => value.isWellFormed()
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  && (value === "" || value.replace(/[\p{Cf}\s]/gu, "").length > 0);
export const plainText = (max: number) => z.string().max(max)
  .transform((value) => value.replace(/\r\n?/g, "\n").trim()).refine(validPlainText);
