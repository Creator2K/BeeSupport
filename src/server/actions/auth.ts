"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  HttpError,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { revokeAgentConnections } from "@/lib/realtime/emit";
import { passwordSchema } from "@/lib/validation";
import { toActionResult, type ActionResult } from "./result";

const profileSchema = z.object({
  name: z.string().trim().min(1, "请填写显示名称").max(40),
  locale: z.enum(["zh-CN", "en"]),
});

export async function updateProfileAction(input: {
  name: string;
  locale: "zh-CN" | "en";
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const data = profileSchema.parse(input);

    await prisma.user.update({
      where: { id: user.id },
      data: { name: data.name, locale: data.locale },
    });

    await recordAudit({
      actorId: user.id,
      actorName: user.name,
      action: "user.profile.update",
      targetType: "User",
      targetId: user.id,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/agent/settings");
    revalidatePath("/agent");
    return { ok: true, message: "已保存" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult> {
  try {
    const sessionUser = await requireUser();
    const newPassword = passwordSchema.parse(input.newPassword);

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, name: true, passwordHash: true, role: true },
    });
    if (!user) throw new HttpError(404, "账号不存在");

    const valid = await verifyPassword(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) return { ok: false, error: "当前密码不正确" };

    const passwordHash = await hashPassword(newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // 让其它设备上的旧会话立即失效
        tokenVersion: { increment: 1 },
      },
      select: { tokenVersion: true },
    });

    // 当前设备重新签发，避免自己被踢下线
    const { createSession } = await import("@/lib/auth");
    await createSession(user.id, user.role, updated.tokenVersion);
    revokeAgentConnections(user.id);

    await recordAudit({
      actorId: user.id,
      actorName: user.name,
      action: "user.password.change",
      targetType: "User",
      targetId: user.id,
    });

    return { ok: true, message: "密码已修改" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function logoutAction(): Promise<ActionResult> {
  const { destroySession } = await import("@/lib/auth");
  await destroySession();

  return { ok: true };
}
