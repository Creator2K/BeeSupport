import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformPage } from "@/lib/platform-page";
import { adminDb } from "@/lib/tenant-db";
import { getServerT } from "@/lib/i18n/server";
import { SMTP_SETTING_KEY, getSmtpConfig, type SmtpConfig } from "@/lib/mail";
import { getAccountPolicy } from "@/server/services/account-access";

import { SettingsClient } from "./settings-client";

export const metadata = { title: "系统设置" };

export default async function SettingsPage() {
  const prisma = await adminDb();
  const admin = await requirePlatformPage();
  const { t } = await getServerT();

  const setting = await prisma.setting.findUnique({
    where: { key: SMTP_SETTING_KEY },
  });
  const smtp = (setting?.value ?? null) as Partial<SmtpConfig> | null;
  const [policy, smtpConfig] = await Promise.all([
    getAccountPolicy(),
    getSmtpConfig(),
  ]);

  return (
    <div>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
      />
      <SettingsClient
        accountPolicy={policy}
        smtpReady={Boolean(smtpConfig)}
        user={{ name: admin.name, email: admin.email, locale: admin.locale }}
        smtp={
          smtp?.host
            ? {
                host: smtp.host,
                port: Number(smtp.port ?? 465),
                secure: Boolean(smtp.secure),
                user: smtp.user ?? "",
                pass: smtp.pass ?? "",
                from: smtp.from ?? "",
              }
            : null
        }
      />
    </div>
  );
}
