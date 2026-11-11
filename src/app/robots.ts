import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

// 管理后台路径可以自定义，它本身就是入口的一部分，不要写进 robots.txt。
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/widget.js"],
      disallow: ["/api/", "/agent", "/widget", "/preview", "/home-preview"],
    },
    ...(base ? { sitemap: new URL("/sitemap.xml", base).href } : {}),
  };
}
