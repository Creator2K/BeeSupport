import { ZodError } from "zod";

import { HttpError } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Server Action 的统一返回结构。
 * 放在独立文件里：带 "use server" 的模块只能导出 async 函数，
 * 同步的辅助函数必须挪出来。
 */
export type ActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

export function toActionResult(error: unknown): ActionResult {
  if (error instanceof HttpError) return { ok: false, error: error.message };
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "参数校验失败" };
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  ) {
    const details = "meta" in error ? JSON.stringify(error.meta) : "";
    if (details.includes("paymentReference"))
      return { ok: false, error: "该收款凭据已用于另一笔订单，请核对后再处理" };
    return { ok: false, error: "邮箱或标识已被使用，请更换后重试" };
  }
  logger.error("action.unhandled_error", {}, error);
  return { ok: false, error: "服务器内部错误，请稍后重试" };
}
