import Link from "next/link";
import { HomeView } from "@/components/home/home-view";
import { requirePlatformPage } from "@/lib/platform-page";
import { adminUrl } from "@/lib/app-paths";
import { getHomeEditor, getPublicHomePlans } from "@/server/services/homepage";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "首页草稿预览",
  robots: { index: false, follow: false },
};
export default async function Page() {
  await requirePlatformPage();
  const { content } = await getHomeEditor();
  return (
    <div>
      <div
        role="status"
        className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        首页草稿预览 · 公开首页仍展示已发布内容。
        <Link href={adminUrl("/homepage")} className="ml-3 underline">
          返回编辑
        </Link>
      </div>
      <HomeView content={content} plans={await getPublicHomePlans(content)} />
    </div>
  );
}
