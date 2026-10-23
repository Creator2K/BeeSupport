"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin, requirePlatformAdmin, HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { ACCOUNT_POLICY_KEY } from "@/lib/account-links";
import { getSmtpConfig } from "@/lib/mail";
import {
  createInvitation,
  revokeInvitation,
  invitationSchema,
} from "@/server/services/account-access";
import { toActionResult } from "./result";

export async function saveAccountPolicyAction(input: {
  requireEmailVerification: boolean;
}) {
  try {
    const admin = await requirePlatformAdmin();
    const data = z
      .object({ requireEmailVerification: z.boolean() })
      .strict()
      .parse(input);
    if (data.requireEmailVerification && !(await getSmtpConfig()))
      throw new HttpError(400, "请先配置 SMTP 邮件服务，再开启邮箱验证");
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: ACCOUNT_POLICY_KEY },
        create: { key: ACCOUNT_POLICY_KEY, value: data },
        update: { value: data },
      });
      await tx.auditLog.create({
        data: {
          tenantId: admin.tenantId,
          actorId: admin.id,
          actorName: admin.name,
          action: "settings.account-policy.update",
          targetType: "Setting",
          targetId: ACCOUNT_POLICY_KEY,
          meta: data,
        },
      });
    });
    revalidatePath("/admin/settings");
    revalidatePath(`${ADMIN_PATH}/settings`);
    return { ok: true as const, message: "账号策略已保存" };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function inviteAgentAction(
  input: z.input<typeof invitationSchema>,
  resendId?: string,
) {
  try {
    const admin = await requireAdmin();
    await createInvitation(admin, input, resendId);
    revalidatePath("/admin/agents");
    revalidatePath(`${ADMIN_PATH}/agents`);
    return {
      ok: true as const,
      message: "邀请邮件已加入发送队列，有效期 72 小时",
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function revokeAgentInvitationAction(id: string) {
  try {
    const admin = await requireAdmin();
    await revokeInvitation(admin, z.string().min(1).max(100).parse(id));
    revalidatePath("/admin/agents");
    revalidatePath(`${ADMIN_PATH}/agents`);
    return { ok: true as const, message: "邀请已撤销" };
  } catch (error) {
    return toActionResult(error);
  }
}
