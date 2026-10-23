import type { Metadata } from "next";
import { HomeView } from "@/components/home/home-view";
import {
  getPublishedHome,
  getPublicHomePlans,
} from "@/server/services/homepage";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedHome();
  return {
    title: { absolute: `${content.brandName} · 连接每个站点，让服务更进一步` },
    description: content.description,
  };
}
export default async function HomePage() {
  const content = await getPublishedHome();
  return (
    <HomeView content={content} plans={await getPublicHomePlans(content)} />
  );
}
