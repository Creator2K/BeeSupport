export type SiteConfig = {
  title: string;
  logoUrl: string;
  footerText: string;
  imagesEnabled: boolean;
  filesEnabled: boolean;
  emojiEnabled: boolean;
  ratingEnabled: boolean;
  maxUploadMB: number;
  name: string;
  publicKey: string;
  primaryColor: string;
  position: string;
  welcomeMessage: string;
  offlineMessage: string;
  requireEmail: boolean;
};

export type Availability = {
  online: boolean;
  agentsOnline: number;
  withinWorkHours: boolean;
};
