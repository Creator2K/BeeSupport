import { getRequestContext } from "../server/request-context";

export type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|session)/i;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2_000;

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : value;
}

export function redactLogText(value: string): string {
  return truncate(
    value
      .replace(
        /\b(postgres(?:ql)?|redis(?:s)?):\/\/[^\s/@]*@/gi,
        "$1://[REDACTED]@",
      )
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:gho|ghp|github_pat)_[A-Za-z0-9_]+/g, "[REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]"),
  );
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactLogText(error.message),
      ...(error.stack ? { stack: redactLogText(error.stack) } : {}),
    };
  }
  return { message: redactLogText(String(error)) };
}

export function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactLogText(value);
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : sanitizeLogValue(item, depth + 1, seen);
  }
  return result;
}

export function buildLogRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  error?: unknown,
): Record<string, unknown> {
  const context = getRequestContext();
  const safeFields = sanitizeLogValue(fields) as Record<string, unknown>;
  return {
    ...safeFields,
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "beesupport",
    ...(context
      ? {
          requestId: context.requestId,
          method: context.method,
          path: context.path,
        }
      : {}),
    ...(error === undefined ? {} : { error: serializeError(error) }),
  };
}

function write(
  level: LogLevel,
  event: string,
  fields?: LogFields,
  error?: unknown,
): void {
  const record = buildLogRecord(level, event, fields, error);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields, error?: unknown) =>
    write("error", event, fields, error),
};
