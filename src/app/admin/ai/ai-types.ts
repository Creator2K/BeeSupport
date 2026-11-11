export type AiFormState = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  assistantName: string;
  systemPrompt: string;
  autoReply: "off" | "no_agent" | "always";
  temperature: number;
  maxTokens: number;
  topK: number;
  historyLimit: number;
  enableEmbeddings: boolean;
  embeddingModel: string;
  enableTools: boolean;
  maxToolRounds: number;
};

export type KnowledgeRecord = {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  enabled: boolean;
  siteId: string | null;
  siteName: string | null;
  chunkCount: number;
  indexStatus?: string | null;
};

export type IndexStats = {
  entries: number;
  chunks: number;
  vectorized: number;
  pending: number;
  processing: number;
  failed: number;
};

export type SiteOption = { id: string; name: string };

export type KnowledgeDraft = {
  id: string | null;
  title: string;
  content: string;
  keywords: string;
  siteId: string;
  enabled: boolean;
};

export type AiFormUpdater = <K extends keyof AiFormState>(
  key: K,
  value: AiFormState[K],
) => void;

export const EMPTY_DRAFT: KnowledgeDraft = {
  id: null,
  title: "",
  content: "",
  keywords: "",
  siteId: "__global__",
  enabled: true,
};
