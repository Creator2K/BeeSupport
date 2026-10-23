import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

import type { UploaderType } from "@prisma/client";

import { env } from "./env";
import { HttpError } from "./auth";

/**
 * 文件存储：默认落到本地磁盘（Docker 里挂在 /app/data/uploads 卷上）。
 * 存储键形如 <siteId>/2026/10/<uuid>.png，所有读取都要先过存储键校验，
 * 杜绝 ../ 穿越。
 */
const storageRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

// 允许的类型白名单（刻意不含 svg，避免存储型 XSS）
const ALLOWED_MIME = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["application/zip", "zip"],
  ["application/json", "json"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/msword", "doc"],
  ["application/vnd.ms-excel", "xls"],
]);

export type SavedUpload = {
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
};

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function allowedMimeTypes(): string[] {
  return [...ALLOWED_MIME.keys()];
}

/** Enforce the limit while consuming multipart data, including chunked requests. */
export async function readUploadForm(request: Request): Promise<FormData> {
  const limit = env.UPLOAD_MAX_BYTES + 1024 * 1024;
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new HttpError(413, "上传请求过大");
  if (!request.body)
    throw new HttpError(400, "缺少上传内容");

  const contentType = request.headers.get("content-type") ?? "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        // Node 24 can emit an unhandled rejection when a FormData-backed
        // Request stream is cancelled. Release the lock in finally and let
        // the HTTP layer terminate the oversized request instead.
        throw new HttpError(413, "上传请求过大");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "上传数据格式不正确");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return await new Response(bytes, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new HttpError(400, "上传数据格式不正确");
  }
}

export async function streamUpload(storageKey: string) {
  try {
    const absolute = resolveStoragePath(storageKey);
    const info = await stat(absolute);
    return {
      size: info.size,
      body: Readable.toWeb(
        createReadStream(absolute),
      ) as ReadableStream<Uint8Array>,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(404, "文件不存在或已被清理");
    throw error;
  }
}

export async function saveUpload(
  file: File,
  options: {
    siteId: string;
    uploader: UploaderType;
    uploaderId?: string | null;
  },
): Promise<SavedUpload> {
  if (!file || file.size === 0) {
    throw new HttpError(400, "文件为空");
  }
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new HttpError(
      413,
      `文件过大，单个文件上限 ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)}MB`,
    );
  }

  const declaredMime = (file.type || "").toLowerCase();
  const ext = ALLOWED_MIME.get(declaredMime);
  if (!ext) {
    throw new HttpError(415, `不支持的文件类型：${declaredMime || "未知"}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // 用文件头二次校验，避免伪造 Content-Type
  if (!looksLikeMime(buffer, declaredMime)) {
    throw new HttpError(415, "文件内容与类型不匹配，已拒绝");
  }

  const now = new Date();
  const dir = path.join(
    options.siteId,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
  );
  const storageKey = path.posix.join(dir, `${randomUUID()}.${ext}`);
  const absolute = resolveStoragePath(storageKey);

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);

  return {
    storageKey,
    filename: sanitizeFilename(file.name) || `file.${ext}`,
    mimeType: declaredMime,
    size: buffer.byteLength,
  };
}

export function resolveStoragePath(storageKey: string): string {
  const normalized = path.posix.normalize(storageKey).replace(/^\/+/, "");
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
    throw new HttpError(400, "非法的存储路径");
  }
  const absolute = path.resolve(storageRoot, normalized);
  if (!absolute.startsWith(`${storageRoot}${path.sep}`)) {
    throw new HttpError(400, "非法的存储路径");
  }
  return absolute;
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(resolveStoragePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, "文件不存在或已被清理");
    }
    throw error;
  }
}

export async function deleteUpload(storageKey: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sanitizeFilename(name: string): string {
  return (name || "")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 180);
}

/** 只做轻量的魔数校验，覆盖白名单里的常见类型 */
function looksLikeMime(buffer: Buffer, mime: string): boolean {
  const head = buffer.subarray(0, 12);
  const hex = head.toString("hex");

  switch (mime) {
    case "image/png":
      return hex.startsWith("89504e47");
    case "image/jpeg":
      return hex.startsWith("ffd8ff");
    case "image/gif":
      return hex.startsWith("47494638");
    case "image/webp":
      return (
        head.subarray(0, 4).toString("ascii") === "RIFF" &&
        head.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "image/avif":
      return head.subarray(4, 8).toString("ascii") === "ftyp";
    case "application/pdf":
      return hex.startsWith("25504446");
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return hex.startsWith("504b0304") || hex.startsWith("504b0506");
    case "application/msword":
    case "application/vnd.ms-excel":
      return hex.startsWith("d0cf11e0");
    default:
      // 文本类不做魔数校验
      return true;
  }
}
