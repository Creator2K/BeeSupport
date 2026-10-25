import type { Prisma } from "@prisma/client";

import { HttpError, type SessionUser } from "../../lib/auth";

export function assertPlatform(actor: SessionUser) {
  if (actor.role !== "ADMIN")
    throw new HttpError(403, "仅平台管理员可查看和重试通知任务");
}
export function stateWhere(state: string): Prisma.NotificationJobWhereInput {
  if (state === "SUCCESS" || state === "SKIPPED")
    return { status: "DELIVERED", outcome: state };
  if (state === "LEGACY") return { status: "DELIVERED", outcome: null };
  return ["PENDING", "PROCESSING", "FAILED"].includes(state)
    ? { status: state }
    : {};
}
