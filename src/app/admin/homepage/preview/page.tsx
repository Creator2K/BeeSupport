import { redirect } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform-page";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePlatformPage();
  redirect("/home-preview");
}
