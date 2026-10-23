export type AgentRecord = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  active: boolean;
  status: "ONLINE" | "AWAY" | "OFFLINE";
  siteIds: string[];
  lastSeenAt: string | null;
  createdAt: string;
  emailVerificationPending?: boolean;
};

export type AgentSiteOption = { id: string; name: string };
