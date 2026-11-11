import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { getAiConfig } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { requirePlatformPage } from "@/lib/platform-page";
import { adminDb } from "@/lib/tenant-db";
import { getServerT } from "@/lib/i18n/server";
import { knowledgeIndexStats } from "@/server/services/knowledge";
import { getMerchantAiSettings } from "@/server/services/ai-policy";

import { AiClient } from "./ai-client";
import { MerchantAiClient } from "./merchant-ai-client";

export const metadata = { title: "AI 助手" };
export const dynamic = "force-dynamic";

export default async function AiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "AGENT") notFound();
  const { t } = await getServerT();

  if (user.role === "MERCHANT_ADMIN") {
    const settings = await getMerchantAiSettings(user);
    return (
      <div>
        <PageHeader
          title={t("ai.title")}
          description="配置商家与站点级自动回复、提示词、工具权限和月度用量上限。"
        />
        <MerchantAiClient settings={settings} />
      </div>
    );
  }

  const prisma = await adminDb();
  await requirePlatformPage();

  const [config, knowledge, sites, indexStats] = await Promise.all([
    getAiConfig(),
    prisma.aiKnowledge.findMany({
      orderBy: [{ siteId: "asc" }, { createdAt: "asc" }],
      include: {
        site: { select: { id: true, name: true } },
        _count: { select: { chunks: true } },
        indexJob: { select: { status: true } },
      },
    }),
    prisma.site.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    knowledgeIndexStats(),
  ]);

  const entries = knowledge.map((entry) => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    keywords: entry.keywords,
    enabled: entry.enabled,
    siteId: entry.siteId,
    siteName: entry.site?.name ?? null,
    chunkCount: entry._count.chunks,
    indexStatus: entry.indexJob?.status ?? null,
  }));

  return (
    <div>
      <PageHeader title={t("ai.title")} description={t("ai.subtitle")} />
      <AiClient
        config={config}
        entries={entries}
        sites={sites}
        indexStats={indexStats}
      />
    </div>
  );
}
