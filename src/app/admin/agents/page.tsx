import { PageHeader } from "@/components/admin/page-header";
import { getServerT } from "@/lib/i18n/server";
import { adminDb } from "@/lib/tenant-db";
import { formatDateTime } from "@/lib/format";

import { AgentsClient } from "./agents-client";
import { TeamInvitations } from "./team-invitations";
import { requireAdmin } from "@/lib/auth";
import { getSmtpConfig } from "@/lib/mail";
import { listInvitations } from "@/server/services/account-access";

export const metadata = { title: "客服账号" };

export default async function AgentsPage() {
  const prisma = await adminDb();
  const { t, locale } = await getServerT();
  const admin = await requireAdmin();
  const [invitations, smtpConfig, ownSites, team] = await Promise.all([
    listInvitations(admin),
    getSmtpConfig(),
    prisma.site.findMany({
      where: { tenantId: admin.tenantId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findUnique({
      where: { id: admin.tenantId },
      select: { name: true },
    }),
  ]);

  const [agents, sites] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { sites: { select: { siteId: true } } },
    }),
    prisma.site.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const data = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role === "AGENT" ? ("AGENT" as const) : ("ADMIN" as const),
    active: agent.active,
    status: agent.status,
    siteIds: agent.sites.map((item) => item.siteId),
    lastSeenAt: agent.lastSeenAt
      ? formatDateTime(agent.lastSeenAt, locale)
      : null,
    createdAt: formatDateTime(agent.createdAt, locale),
    emailVerificationPending:
      agent.emailVerificationRequired && !agent.emailVerifiedAt,
  }));

  return (
    <div>
      <PageHeader
        title={t("agents.title")}
        description={t("agents.subtitle")}
      />
      <AgentsClient agents={data} sites={sites} />
      <TeamInvitations
        invitations={invitations}
        sites={ownSites}
        team={team?.name ?? "当前团队"}
        smtpReady={Boolean(smtpConfig)}
      />
    </div>
  );
}
