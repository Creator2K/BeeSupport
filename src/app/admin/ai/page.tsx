import { PageHeader } from "@/components/admin/page-header";
import { getAiConfig } from "@/lib/ai";
import { requirePlatformPage } from "@/lib/platform-page";
import { adminDb } from "@/lib/tenant-db";
import { getServerT } from "@/lib/i18n/server";
import { knowledgeIndexStats } from "@/server/services/knowledge";

import { AiClient } from "./ai-client";

export const metadata = { title: "AI 助手" };
export const dynamic = "force-dynamic";

export default async function AiPage() {
  const prisma = await adminDb();
  await requirePlatformPage();
  const { t } = await getServerT();

  const [config, knowledge, sites, indexStats] = await Promise.all([
    getAiConfig(),
    prisma.aiKnowledge.findMany({
      orderBy: [{ siteId: "asc" }, { createdAt: "asc" }],
      include: {
        site: { select: { id: true, name: true } },
        _count: { select: { chunks: true } },
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
