import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/app-paths";
import { availableModels, getAiConfig, isAiReady } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/server";
import { parsePreferences } from "@/lib/preferences";
import { listConversations } from "@/server/services/conversations";
import { getTenantFeatures } from "@/server/services/entitlements";

import { AgentWorkbench } from "./agent-workbench";

export const metadata = { title: "客服工作台" };
export const dynamic = "force-dynamic";

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const initialConversationId =
    typeof params.c === "string" && params.c.length > 0 ? params.c : null;

  const [result, sites, preferenceRow] = await Promise.all([
    listConversations(user, { pageSize: 50 }),
    prisma.site.findMany({
      where:
        user.siteIds === null
          ? { active: true }
          : { active: true, id: { in: user.siteIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    }),
  ]);

  const locale = await getServerLocale();
  const aiConfig = await getAiConfig();
  const features = await getTenantFeatures(user.tenantId);

  return (
    <AgentWorkbench
      me={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      }}
      locale={locale}
      initialConversations={result.items}
      sites={sites}
      initialConversationId={initialConversationId}
      initialPreferences={parsePreferences(preferenceRow?.preferences)}
      ai={{
        ready: features.ai && isAiReady(aiConfig),
        models: availableModels(aiConfig),
        defaultModel: aiConfig.model || null,
      }}
      adminPath={ADMIN_PATH}
    />
  );
}
