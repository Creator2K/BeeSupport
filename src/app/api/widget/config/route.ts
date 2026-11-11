import { getWidgetSettings } from "@/server/services/tenants";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { clientIp, rateLimit, rateLimitSource } from "@/lib/rate-limit";
import { getSiteAvailability, resolveSiteByKey } from "@/lib/widget";
import { resolveLocaleFromHeader } from "@/lib/i18n/config";
import { assertWidgetOriginAllowed } from "@/lib/widget-origin";

/**
 * 访客端启动时拉取的站点公开配置（不含任何敏感字段）。
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 不需要访客身份就能调，每次要查几次库；正常是每次打开页面拉一次
    const source = rateLimitSource(clientIp(request.headers));
    if (!(await rateLimit(`widget:config:${source}`, 600, 300)).ok)
      throw new HttpError(429, "请求过于频繁，请稍后再试");

    const url = new URL(request.url);
    const site = await resolveSiteByKey(url.searchParams.get("key"));
    await assertWidgetOriginAllowed(site, request.headers);

    const settings = await getWidgetSettings(site.id);
    const availability = await getSiteAvailability(site);

    return NextResponse.json({
      site: {
        ...settings,
        name: site.name,
        publicKey: site.publicKey,
        primaryColor: site.primaryColor,
        position: site.position,
        welcomeMessage: site.welcomeMessage,
        offlineMessage: site.offlineMessage,
        requireEmail: site.requireEmail,
      },
      availability,
      locale: resolveLocaleFromHeader(request.headers.get("accept-language")),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
