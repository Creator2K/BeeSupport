import type { ConversationStatus } from "@prisma/client";

import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/auth";
import { adminDb } from "@/lib/tenant-db";
import { getServerT } from "@/lib/i18n/server";
import { listConversations } from "@/server/services/conversations";
import { ADMIN_PATH } from "@/lib/app-paths";

import { ConversationsClient } from "./conversations-client";

export const metadata = { title: "会话记录" };

const STATUSES: ConversationStatus[] = ["PENDING", "OPEN", "CLOSED"];

export default async function AdminConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const prisma = await adminDb();
  const admin = await requireAdmin();
  const { t } = await getServerT();
  const params = await searchParams;

  const readString = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const statusParam = readString("status");
  const status =
    statusParam && STATUSES.includes(statusParam as ConversationStatus)
      ? (statusParam as ConversationStatus)
      : undefined;

  const result = await listConversations(admin, {
    status,
    siteId: readString("siteId"),
    query: readString("query"),
    page: Number(readString("page") ?? 1) || 1,
    pageSize: 20,
  });

  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <PageHeader
        title={t("conversations.title")}
        description={t("conversations.subtitle")}
      />
      <ConversationsClient
        adminPath={ADMIN_PATH}
        items={result.items}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        sites={sites}
        filters={{
          status: statusParam ?? "",
          siteId: readString("siteId") ?? "",
          query: readString("query") ?? "",
        }}
      />
    </div>
  );
}
