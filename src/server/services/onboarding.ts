import { prisma } from "../../lib/db";
import { ADMIN_PATH } from "../../lib/app-paths";
import type { WidgetOriginContext } from "../../lib/widget-origin";

export async function recordSiteEmbed(
  siteId: string,
  context: WidgetOriginContext,
) {
  if (!context.embedded || context.preview || !context.origin) return;
  try {
    const origin = new URL(context.origin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== context.origin
    )
      return;
  } catch {
    return;
  }
  const now = new Date();
  await prisma.site.updateMany({
    where: {
      id: siteId,
      OR: [
        { embedSeenAt: null },
        { embedSeenAt: { lt: new Date(now.getTime() - 300000) } },
        { embedOrigin: { not: context.origin } },
      ],
    },
    data: { embedSeenAt: now, embedOrigin: context.origin },
  });
}
export async function getOnboarding(tenantId: string) {
  const [sites, agents, tenant] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        active: true,
        publicKey: true,
        embedSeenAt: true,
        embedOrigin: true,
        _count: {
          select: {
            conversations: {
              where: { messages: { some: { sender: "VISITOR" } } },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.count({
      where: {
        tenantId,
        role: "AGENT",
        active: true,
        sites: { some: { site: { tenantId, active: true } } },
      },
    }),
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, expiresAt: true },
    }),
  ]);
  return {
    sites: sites.map(({ _count, ...site }) => ({
      ...site,
      hasConversation: _count.conversations > 0,
      embedSeenAt: site.embedSeenAt?.toISOString() ?? null,
    })),
    hasSite: sites.some((site) => site.active),
    hasConversation: sites.some((site) => site._count.conversations > 0),
    hasTeam: agents > 0,
    embedded: sites.some((site) => site.active && site.embedSeenAt),
    complete: sites.some(
      (site) =>
        site.active && site.embedSeenAt && site._count.conversations > 0,
    ),
    tenantName: tenant.name,
    expired: Boolean(tenant.expiresAt && tenant.expiresAt <= new Date()),
  };
}
export async function loginDestination(user: {
  role: string;
  tenantId: string;
}) {
  if (user.role === "AGENT") return "/agent";
  if (
    user.role === "MERCHANT_ADMIN" &&
    (await prisma.site.count({ where: { tenantId: user.tenantId } })) === 0
  )
    return `${ADMIN_PATH}/onboarding`;
  return ADMIN_PATH;
}
