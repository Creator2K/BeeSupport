import Link from "next/link";
import { AccountSettings } from "@/components/account-settings";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";

export const metadata = { title: "我的账号" };

export default async function AgentSettingsPage() {
  const user = await requireUser();
  const { t } = await getServerT();
  return (
    <main className="h-dvh overflow-y-auto px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={t("settings.profile")}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/agent">{t("common.back")}</Link>
            </Button>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <AccountSettings
            user={{ name: user.name, email: user.email, locale: user.locale }}
          />
        </div>
      </div>
    </main>
  );
}
