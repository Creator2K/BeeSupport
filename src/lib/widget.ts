import { HttpError } from "./auth";
import { countOnlineAgents } from "./auth";
import { tenantCanServe, getWidgetSettings } from "../server/services/tenants";
import { prisma } from "./db";

export { isWithinWorkHours } from "./work-hours";
import { isWithinWorkHours } from "./work-hours";

export type SiteAvailability = {
  online: boolean;
  agentsOnline: number;
  withinWorkHours: boolean;
};

export async function getSiteAvailability(site: {
  id: string;
  workHours: unknown;
}): Promise<SiteAvailability> {
  const withinWorkHours = isWithinWorkHours(site.workHours);
  const agentsOnline = await countOnlineAgents(site.id);

  return {
    online: withinWorkHours && agentsOnline > 0,
    agentsOnline,
    withinWorkHours,
  };
}

export async function resolveSiteByKey(key: string | null | undefined) {
  if (!key) throw new HttpError(400, "缺少站点密钥");

  const site = await prisma.site.findUnique({
    where: { publicKey: key },
    include: { tenant: true },
  });
  if (!site || !site.active || !tenantCanServe(site.tenant))
    throw new HttpError(404, "站点不存在或已停用");
  const settings = await getWidgetSettings(site.id);
  return {
    ...site,
    primaryColor: settings.primaryColor,
    position: settings.position,
  };
}

/**
 * 域名白名单校验：allowedOrigins 为空表示不限制（方便内网/预发联调）。
 * 支持填 example.com 或 https://example.com。
 */
export function assertOriginAllowed(
  site: { allowedOrigins: string[] },
  headers: Headers,
): void {
  if (site.allowedOrigins.length === 0) return;

  const source =
    headers.get("origin") ??
    (() => {
      const referer = headers.get("referer");
      if (!referer) return null;
      try {
        return new URL(referer).origin;
      } catch {
        return null;
      }
    })();

  if (!source) {
    throw new HttpError(403, "缺少来源信息，已按域名白名单拒绝");
  }

  const host = (() => {
    try {
      return new URL(source).host;
    } catch {
      return source;
    }
  })();

  const allowed = site.allowedOrigins.some((entry) => {
    const normalized = entry
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "");
    if (!normalized) return false;
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(2);
      return (
        host.toLowerCase() === suffix ||
        host.toLowerCase().endsWith(`.${suffix}`)
      );
    }
    return host.toLowerCase() === normalized;
  });

  if (!allowed) {
    throw new HttpError(403, `域名 ${host} 不在该站点的白名单内`);
  }
}
