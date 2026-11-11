"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { HttpError, requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { clearRiskRuleCache } from "@/server/services/risk";
import { resourceTenantId } from "@/server/services/tenants";
import { recordAudit } from "@/lib/audit";
import { getIo } from "@/lib/realtime/emit";
import { matchesIp, normalizeRiskText, parseIpRule } from "@/lib/risk-matching";
import { toActionResult } from "./result";
import { ADMIN_PATH } from "@/lib/app-paths";

const schema = z.object({
  kind: z.enum(["WORD", "IP"]),
  values: z.string().trim().min(1).max(20000),
  siteId: z.string().max(128).nullable(),
  note: z.string().trim().max(300).default(""),
  expiresAt: z.string().nullable(),
});

export async function saveRiskRuleAction(
  input: z.input<typeof schema>,
  id?: string,
) {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const parsed = schema.parse(input);
    const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
    if (
      expiresAt &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    )
      throw new HttpError(400, "到期时间必须晚于当前时间");
    const values = [
      ...new Set(
        parsed.values
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter(Boolean)
          .map((value) => {
            if (value.length > 100)
              throw new HttpError(400, "每条规则最多 100 个字符");
            if (parsed.kind === "IP") {
              try {
                return parseIpRule(value).value;
              } catch {
                throw new HttpError(400, `无效 IP 或网段：${value}`);
              }
            }
            const word = normalizeRiskText(value);
            if (!word) throw new HttpError(400, "违禁词不能为空");
            return word;
          }),
      ),
    ];
    if (!values.length || values.length > 200 || (id && values.length !== 1))
      throw new HttpError(400, "每次可添加 1–200 条规则，编辑时仅保留一条");
    if (
      parsed.siteId &&
      !(await prisma.site.findUnique({
        where: { id: parsed.siteId },
        select: { id: true },
      }))
    )
      throw new HttpError(404, "站点不存在");
    const previous = id
      ? await prisma.riskRule.findUnique({
          where: { id },
          select: { tenantId: true },
        })
      : null;
    const tenantId = await resourceTenantId(
      admin,
      parsed.siteId,
      previous?.tenantId,
    );
    const rules = await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { updatedAt: new Date() },
      });
      const existing = id
        ? await tx.riskRule.findUnique({ where: { id } })
        : null;
      if (id && !existing) throw new HttpError(404, "规则不存在");
      const count = await tx.riskRule.count();
      if (!id && count + values.length > 5000)
        throw new HttpError(400, "规则总数最多 5000 条，请先清理不用的规则");
      const saved = [];
      for (const value of values) {
        const duplicate = await tx.riskRule.findFirst({
          where: {
            tenantId,
            kind: parsed.kind,
            value,
            siteId: parsed.siteId,
            ...(id ? { id: { not: id } } : {}),
          },
        });
        if (id && duplicate)
          throw new HttpError(400, "相同作用范围内已有这条规则");
        const data = {
          tenantId,
          kind: parsed.kind,
          value,
          siteId: parsed.siteId,
          note: parsed.note || null,
          expiresAt,
          active: existing?.active ?? true,
        };
        saved.push(
          id || duplicate
            ? await tx.riskRule.update({
                where: { id: id || duplicate!.id },
                data,
              })
            : await tx.riskRule.create({ data }),
        );
      }
      return saved;
    });
    // 先清缓存再做后面的事：下面断开的连接会立刻重连，重连时必须已经按新规则判断
    clearRiskRuleCache();
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: id ? "risk.update" : "risk.create",
      targetType: "RiskRule",
      targetId: rules[0]?.id,
      meta: { kind: parsed.kind, count: rules.length, siteId: parsed.siteId },
    });
    const ips = rules.filter((rule) => rule.kind === "IP" && rule.active);
    if (ips.length) {
      const scopeSiteIds = new Set(
        (
          await prisma.site.findMany({
            where: { tenantId },
            select: { id: true },
          })
        ).map((site) => site.id),
      );
      const sockets = await getIo()?.fetchSockets();
      for (const socket of sockets ?? []) {
        const visitor = socket.data.identity?.visitor;
        if (
          visitor &&
          scopeSiteIds.has(visitor.siteId) &&
          ips.some(
            (rule) =>
              (!rule.siteId || rule.siteId === visitor.siteId) &&
              matchesIp(socket.data.clientIp || "", rule.value),
          )
        ) {
          socket.emit("session:revoked");
          socket.disconnect(true);
        }
      }
    }
    revalidatePath("/admin/risk");
    revalidatePath(`${ADMIN_PATH}/risk`);
    return { ok: true as const, message: `已保存 ${rules.length} 条规则` };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function setRiskRuleActiveAction(id: string, active: boolean) {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    const rule = await prisma.riskRule.findUnique({ where: { id } });
    if (!rule) throw new HttpError(404, "规则不存在");
    if (active && rule.expiresAt && rule.expiresAt <= new Date())
      throw new HttpError(400, "规则已到期，请先编辑到期时间");
    const updated = await prisma.riskRule.update({
      where: { id },
      data: { active },
    });
    clearRiskRuleCache();
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: active ? "risk.enable" : "risk.disable",
      targetType: "RiskRule",
      targetId: id,
    });
    if (active && rule.kind === "IP") {
      const scopeSiteIds = new Set(
        (
          await prisma.site.findMany({
            where: { tenantId: rule.tenantId },
            select: { id: true },
          })
        ).map((site) => site.id),
      );
      for (const socket of (await getIo()?.fetchSockets()) ?? []) {
        const visitor = socket.data.identity?.visitor;
        if (
          visitor &&
          scopeSiteIds.has(visitor.siteId) &&
          (!rule.siteId || rule.siteId === visitor.siteId) &&
          matchesIp(socket.data.clientIp || "", rule.value)
        ) {
          socket.emit("session:revoked");
          socket.disconnect(true);
        }
      }
    }
    revalidatePath("/admin/risk");
    revalidatePath(`${ADMIN_PATH}/risk`);
    return {
      ok: true as const,
      rule: {
        id: updated.id,
        active: updated.active,
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function deleteRiskRuleAction(id: string) {
  try {
    const admin = await requireAdmin();
    const prisma = await adminDb();
    await prisma.riskRule.deleteMany({ where: { id } });
    clearRiskRuleCache();
    await recordAudit({
      actorId: admin.id,
      actorName: admin.name,
      action: "risk.delete",
      targetType: "RiskRule",
      targetId: id,
    });
    revalidatePath("/admin/risk");
    revalidatePath(`${ADMIN_PATH}/risk`);
    return { ok: true as const };
  } catch (error) {
    return toActionResult(error);
  }
}
