import type { TenantInput } from "@/server/actions/tenants";

export type Merchant = Omit<
  TenantInput,
  "expiresAt" | "contactEmail" | "note"
> & {
  id: string;
  managementVersion: number;
  expiresAt: string | null;
  contactEmail: string | null;
  note: string | null;
  usage: {
    agents: number;
    sites: number;
    conversations: number;
    storageBytes: number;
  };
};

export const merchantStatusLabels = {
  PENDING: "待审核",
  ACTIVE: "已开通",
  SUSPENDED: "已停用",
};
