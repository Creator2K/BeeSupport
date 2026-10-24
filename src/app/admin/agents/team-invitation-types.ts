export type TeamInvitationRole = "AGENT" | "MERCHANT_ADMIN";

export type Invitation = {
  id: string;
  email: string;
  role: string;
  siteIds: string[];
  expiresAt: string;
};

export type InviteInput = {
  email: string;
  role: TeamInvitationRole;
  siteIds: string[];
};
