export type WorkbenchMe = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ONLINE" | "AWAY" | "OFFLINE";
};

export type CannedItem = {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  siteId: string | null;
  category: string;
  shared: boolean;
};

export type TransferTarget = {
  id: string;
  name: string;
  email: string;
  status: string;
};

export type AiSuggestionTrace = {
  model: string | null;
  tools: { name: string; summary: string; ok: boolean; ms: number }[];
  knowledge: { title: string; score: number; via: string }[];
};
