import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformPage } from "@/lib/platform-page";
import { getCollectionSettings } from "@/server/services/collection";
import { CollectionEditor } from "./collection-editor";
export const dynamic = "force-dynamic";
export const metadata = { title: "收款配置" };
export default async function Page() {
  await requirePlatformPage();
  const initial = await getCollectionSettings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="收款配置"
        description="向已登录的商家展示人工收款说明、收款码和联系方式。商家反馈付款后，由平台核对到账并审核开通。"
      />
      <CollectionEditor initial={initial} />
    </div>
  );
}
