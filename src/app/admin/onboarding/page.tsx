import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { env } from "@/lib/env";
import { getOnboarding } from "@/server/services/onboarding";
import { OnboardingGuide } from "./onboarding-guide";
export const dynamic = "force-dynamic";
export const metadata = { title: "接入向导" };
export default async function Page() {
  const user = await requireAdmin();
  if (user.role !== "MERCHANT_ADMIN") notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        title="接入向导"
        description="按步骤接通你的第一个站点，进度来自真实配置与使用记录。"
      />
      <OnboardingGuide
        state={await getOnboarding(user.tenantId)}
        appUrl={env.APP_URL}
        basePath={ADMIN_PATH}
      />
      <Link href={ADMIN_PATH} className="inline-block text-sm underline">
        前往概览，稍后继续
      </Link>
    </div>
  );
}
