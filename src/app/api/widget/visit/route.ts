import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, toErrorResponse } from "@/lib/api";
import { HttpError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { resolveSiteByKey } from "@/lib/widget";
import { assertWidgetOriginAllowed } from "@/lib/widget-origin";
import { pickVisitorEnv } from "@/lib/visitor-env";
import { assertIpAllowed } from "@/server/services/risk";
import { touchVisitorOnSession } from "@/server/services/visitors";
import { recordSiteEmbed } from "@/server/services/onboarding";

const schema = z.object({
  key: z.string().min(1).max(128),
  localKey: z.string().min(8).max(64),
  pageUrl: z.string().max(500).optional(),
  pageTitle: z.string().max(200).optional(),
  referrer: z.string().max(500).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});

/** Anonymous traffic only: this endpoint never returns a chat token or private profile. */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers);
    if (!(await rateLimit(`widget:visit:${ip}`, 120, 300)).ok)
      throw new HttpError(429, "访问上报过于频繁");
    const input = schema.parse(await readJson(request));
    const site = await resolveSiteByKey(input.key);
    const originContext = await assertWidgetOriginAllowed(
      site,
      request.headers,
    );
    await assertIpAllowed({ siteId: site.id, ip, context: "visit" });
    const environment = { ...pickVisitorEnv(input.env), ip };
    const visitor = await prisma.visitor.upsert({
      where: { siteId_localKey: { siteId: site.id, localKey: input.localKey } },
      create: {
        siteId: site.id,
        localKey: input.localKey,
        email: "",
        meta: environment,
        landingPage: input.pageUrl,
        lastPage: input.pageUrl,
        lastPageTitle: input.pageTitle,
        referrer: input.referrer,
      },
      update: { siteId: site.id },
      select: { id: true, blocked: true },
    });
    if (visitor.blocked) throw new HttpError(403, "该访客已被限制");
    await touchVisitorOnSession({
      visitorId: visitor.id,
      env: environment,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      referrer: input.referrer,
    });
    await recordSiteEmbed(site.id, originContext);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
