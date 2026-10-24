export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/* ---------------- 知识库：切片 + 召回 ---------------- */

export const CHUNK_MAX_CHARS = 420;
export const CHUNK_OVERLAP_CHARS = 60;

/**
 * 按段落切片，超长段落再按句子/硬切分，保留少量重叠避免语义被切断。
 */
export function chunkText(
  content: string,
  options: { maxChars?: number; overlap?: number } = {},
): string[] {
  const maxChars = Math.max(80, options.maxChars ?? CHUNK_MAX_CHARS);
  const overlap = Math.max(
    0,
    Math.min(options.overlap ?? CHUNK_OVERLAP_CHARS, maxChars / 2),
  );
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      pieces.push(block);
      continue;
    }
    // 长段落按句子切，句子还长就硬切
    const sentences = block.split(/(?<=[。！？；.!?;])/).filter(Boolean);
    let buffer = "";
    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        if (buffer) {
          pieces.push(buffer);
          buffer = "";
        }
        for (
          let index = 0;
          index < sentence.length;
          index += maxChars - overlap
        ) {
          pieces.push(sentence.slice(index, index + maxChars));
        }
        continue;
      }
      if ((buffer + sentence).length > maxChars) {
        if (buffer) pieces.push(buffer);
        buffer = sentence;
      } else {
        buffer += sentence;
      }
    }
    if (buffer) pieces.push(buffer);
  }

  // 合并过短的碎片，避免产生一堆无意义切片
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.length + piece.length + 1 <= maxChars) {
      merged[merged.length - 1] = `${last}\n${piece}`;
    } else {
      merged.push(piece);
    }
  }

  return merged.map((piece) => piece.slice(0, maxChars * 2));
}
