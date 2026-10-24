import type { AccountAccessDetails } from "./account-access-types";

export async function callAccount(body: Record<string, unknown>): Promise<{
  message: string;
  details: AccountAccessDetails;
}> {
  const response = await fetch("/api/auth/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "??????????");
  return result;
}
