/** Convert transport failures into the same recoverable result as business errors. */
export async function callClientAction<T extends { ok: boolean }>(
  operation: () => Promise<T>,
  fallbackError: string,
): Promise<T | { ok: false; error: string }> {
  try {
    return await operation();
  } catch {
    return { ok: false, error: fallbackError };
  }
}
