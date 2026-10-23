import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRequestContext } from "../server/request-context";
import { HttpError } from "./auth";
import { logger } from "./logger";

/** Bound JSON bodies even when a client sends chunked data without Content-Length. */
export async function readJson(
  request: Request,
  allowEmpty = false,
): Promise<unknown> {
  const maxBytes = 64 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw new HttpError(413, "请求内容过大");
  if (!request.body) {
    if (allowEmpty) return {};
    throw new HttpError(400, "请求内容必须是有效的 JSON");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new HttpError(413, "请求内容过大");
      }
      chunks.push(value);
    }
    if (allowEmpty && size === 0) return {};
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "请求内容必须是有效的 JSON");
  } finally {
    reader.releaseLock();
  }
}

/** 统一的 API 错误映射：HttpError / ZodError / 兜底 500 */
export function toErrorResponse(error: unknown): NextResponse {
  const requestId = getRequestContext()?.requestId;
  const requestMeta = requestId ? { requestId } : {};

  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, ...requestMeta },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "参数校验失败",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        ...requestMeta,
      },
      { status: 422 },
    );
  }

  logger.error("api.unhandled_error", {}, error);
  return NextResponse.json(
    { error: "服务器内部错误", ...requestMeta },
    { status: 500 },
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}
