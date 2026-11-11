import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  if (!base) return [];

  return ["/", "/register", "/login"].map((path) => ({
    url: new URL(path, base).href,
  }));
}
