export type CannedRecord = {
  id: string;
  title: string;
  category: string;
  tenantName: string | null;
  shortcut: string | null;
  content: string;
  siteId: string | null;
  siteName: string | null;
  shared: boolean;
  usageCount: number;
  ownerName: string | null;
};

export type CannedSiteOption = { id: string; name: string };
