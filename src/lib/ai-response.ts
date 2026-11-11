import { AiError } from "./ai-config";

/** Bound decoded response bytes, including chunked or compressed provider responses. */
async function readResponse(
  response: Response,
  limit: number,
  truncate: boolean,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        await reader.cancel().catch(() => {});
        if (!truncate) throw new AiError("AI 接口响应过大");
        chunks.push(value.subarray(0, limit - size));
        size = limit;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readAiError(response: Response): Promise<string> {
  return readResponse(response, 16 * 1024, true).catch(() => "");
}

export async function readAiJson(
  response: Response,
  limit = 1024 * 1024,
): Promise<unknown> {
  const text = await readResponse(response, limit, false);
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid response object");
    return data;
  } catch {
    throw new AiError("AI 接口未返回有效 JSON 对象");
  }
}
