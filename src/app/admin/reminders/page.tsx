import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformPage } from "@/lib/platform-page";
import { getReminderSettings } from "@/server/services/subscription-reminders";
import { getSmtpConfig } from "@/lib/mail";
import { ReminderSettings } from "./reminder-settings";
export const dynamic = "force-dynamic";
export const metadata = { title: "到期提醒" };
export default async function Page() {
  await requirePlatformPage();
  const [initial, smtp] = await Promise.all([
    getReminderSettings(),
    getSmtpConfig(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="到期提醒"
        description="为商家管理员生成站内到期通知，按需开启邮件提醒。收款和套餐开通继续由平台人工核对。"
      />
      <ReminderSettings initial={initial} smtpReady={Boolean(smtp)} />
    </div>
  );
}
