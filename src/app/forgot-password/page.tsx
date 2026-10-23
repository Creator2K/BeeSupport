import { AccountAccessPage } from "@/components/account-access-page";
export const metadata = {
  title: "忘记密码",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function Page() {
  return <AccountAccessPage mode="forgot" />;
}
