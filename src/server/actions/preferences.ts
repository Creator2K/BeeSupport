"use server";

import type { Prisma } from "@prisma/client";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  mergePreferences,
  parsePreferences,
  type AgentPreferences,
} from "@/lib/preferences";
import { toActionResult } from "./result";

/** 客服个人偏好（提示音音色、音量、桌面通知），存在 User.preferences */
export async function savePreferencesAction(
  patch: Partial<AgentPreferences>,
): Promise<
  { ok: true; preferences: AgentPreferences } | { ok: false; error: string }
> {
  try {
    const user = await requireUser();

    const preferences = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const row = await tx.user.findUnique({
        where: { id: user.id },
        select: { preferences: true },
      });

      const preferences = mergePreferences(row?.preferences, patch);

      await tx.user.update({
        where: { id: user.id },
        data: { preferences: preferences as unknown as Prisma.InputJsonValue },
      });
      return preferences;
    });

    return { ok: true, preferences };
  } catch (error) {
    const result = toActionResult(error);
    return { ok: false, error: result.ok ? "保存失败" : result.error };
  }
}

/** 读取当前用户偏好（工作台首屏已通过 props 拿到，这里是兜底） */
export async function loadPreferencesAction(): Promise<AgentPreferences> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });
  return parsePreferences(row?.preferences);
}
