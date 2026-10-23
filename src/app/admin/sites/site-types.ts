import type {
  EffectiveWidgetSettings,
  WidgetSettings,
} from "@/lib/branding";

export type SiteRecord = {
  canCustomizeFooter: boolean;
  widgetSettings: WidgetSettings;
  inheritedSettings: EffectiveWidgetSettings;
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  description: string | null;
  primaryColor: string;
  position: string;
  welcomeMessage: string;
  offlineMessage: string;
  requireEmail: boolean;
  autoAssign: boolean;
  imageReviewEnabled: boolean;
  notifyEmail: string | null;
  allowedOrigins: string[];
  workHours: unknown;
  active: boolean;
  counts: { conversations: number; visitors: number; agents: number };
  agentNames: string[];
};
