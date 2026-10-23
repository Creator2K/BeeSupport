import { z } from "zod";

export const MAX_EXPORT_ROWS = 5000;
export const reportKinds = {
  conversations: "会话摘要",
  orders: "套餐订单",
  audit: "操作日志",
} as const;
export const conversationStatuses = {
  PENDING: "待接入",
  OPEN: "进行中",
  CLOSED: "已结束",
} as const;
export const reportOrderStatuses: Record<string, string> = {
  PENDING: "待平台确认",
  CONFIRMED: "已开通",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
} as const;
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "账号登录",
  "auth.login.failed": "登录失败",
  "auth.login.unknown_user": "未知账号登录",
  "auth.login.rate_limited": "登录频率限制",
  "auth.password.recovered": "邮件找回密码",
  "auth.email.verified": "邮箱验证",
  "user.password.change": "修改密码",
  "user.profile.update": "修改个人资料",
  "site.create": "创建站点",
  "site.update": "更新站点",
  "site.delete": "删除站点",
  "site.enable": "启用站点",
  "site.disable": "停用站点",
  "site.regenerate_key": "重置站点密钥",
  "agent.create": "创建账号",
  "agent.update": "更新账号",
  "agent.delete": "删除账号",
  "agent.password.reset": "管理员重置密码",
  "team.invite.created": "发送团队邀请",
  "team.invite.revoked": "撤销团队邀请",
  "team.invite.accepted": "接受团队邀请",
  "conversation.close": "结束会话",
  "conversation.transfer": "转接会话",
  "conversation.reopen": "重新打开会话",
  "canned.create": "创建话术",
  "canned.update": "更新话术",
  "canned.delete": "删除话术",
  "webhook.create": "创建通知渠道",
  "webhook.update": "更新通知渠道",
  "webhook.delete": "删除通知渠道",
  "notification.retry": "重试通知投递",
  "settings.smtp.update": "更新邮件设置",
  "settings.smtp.test": "测试邮件设置",
  "settings.account-policy.update": "更新邮箱验证策略",
  "settings.ai.update": "更新 AI 设置",
  "settings.ai.test": "测试 AI 设置",
  "tenant.apply": "申请商家入驻",
  "tenant.create": "创建商家",
  "tenant.update": "更新商家",
  "tenant.brand.update": "更新商家默认外观",
  "platform.brand.update": "更新平台默认外观",
  "homepage.draft.save": "保存首页草稿",
  "homepage.publish": "发布首页",
  "subscription.collection.settings": "更新收款配置",
  "subscription.reminders.settings": "更新到期提醒",
  "visitor.profile.update": "更新访客资料",
  "risk.create": "创建风控规则",
  "risk.update": "更新风控规则",
  "risk.delete": "删除风控规则",
  "followup.create": "安排会话跟进",
  "followup.update": "更新会话跟进",
  "followup.complete": "完成会话跟进",
  "followup.cancel": "取消会话跟进",
  "followup.rule.update": "更新自动跟进规则",
  "followup.autoCreate": "自动安排离线留言跟进",
  "unanswered.rule.update": "更新未回复提醒规则",
  "unanswered.remind": "生成未回复提醒",
  "data.export": "生成数据导出",
};

const base = {
  from: z.iso.date(),
  to: z.iso.date(),
  query: z.string().trim().max(120).default(""),
};
export const auditFilterSchema = z
  .object({
    ...base,
    action: z
      .string()
      .trim()
      .max(100)
      .regex(/^[a-z0-9_.-]*$/i)
      .default(""),
  })
  .strict();
export const exportInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("conversations"),
      siteId: z.string().trim().max(128).default(""),
      status: z.enum(["", "PENDING", "OPEN", "CLOSED"]).default(""),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("orders"),
      status: z
        .enum(["", "PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"])
        .default(""),
    })
    .strict(),
  auditFilterSchema.extend({ kind: z.literal("audit") }),
]);
export type ExportInput = z.input<typeof exportInputSchema>;
export type AuditFilterInput = z.input<typeof auditFilterSchema>;

export function beijingDay(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function defaultReportDates(now = new Date()) {
  return {
    from: beijingDay(new Date(now.getTime() - 29 * 86400000)),
    to: beijingDay(now),
  };
}
export function reportDateRange(from: string, to: string, now = new Date()) {
  if (
    !z.iso.date().safeParse(from).success ||
    !z.iso.date().safeParse(to).success
  )
    throw new Error("请选择有效的日期");
  const start = new Date(`${from}T00:00:00+08:00`),
    end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400000);
  const days = (end.getTime() - start.getTime()) / 86400000;
  if (
    !Number.isFinite(days) ||
    days < 1 ||
    days > 90 ||
    from > beijingDay(now) ||
    to > beijingDay(now)
  )
    throw new Error("请选择截至今天、跨度不超过 90 天的有效日期范围");
  return { gte: start, lt: end, lte: now };
}
export function reportTime(value: Date | null) {
  return value
    ? new Date(value.getTime() + 8 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ")
    : "";
}
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function makeCsv(headers: string[], rows: unknown[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
