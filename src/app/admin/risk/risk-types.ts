export type RiskRule = {
  id: string;
  kind: string;
  value: string;
  siteId: string | null;
  siteName: string;
  note: string | null;
  active: boolean;
  expiresAt: string | null;
  expiryLabel: string;
  expired: boolean;
  updatedAt: string;
};

export type RiskEvent = {
  id: string;
  kind: string;
  ruleValue: string;
  ip: string;
  siteName: string;
  visitorId: string | null;
  context: string;
  createdAt: string;
  createdLabel: string;
};

export type RiskSite = { id: string; name: string };

export type RiskFilters = { kind: string; siteId: string; query: string };
