import type {
  AiFormState,
  KnowledgeDraft,
  KnowledgeRecord,
} from "./ai-types";

export function modelOptionsFor(
  form: AiFormState,
  loadedModels: string[],
): string[] {
  return Array.from(
    new Set([...(form.model ? [form.model] : []), ...loadedModels, ...form.models]),
  );
}

export function filterKnowledgeEntries(
  entries: KnowledgeRecord[],
  query: string,
): KnowledgeRecord[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return entries;
  return entries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(keyword) ||
      entry.content.toLowerCase().includes(keyword) ||
      entry.keywords.some((item) => item.toLowerCase().includes(keyword)),
  );
}

export function knowledgeDraftFrom(record: KnowledgeRecord): KnowledgeDraft {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    keywords: record.keywords.join(", "),
    siteId: record.siteId ?? "__global__",
    enabled: record.enabled,
  };
}

export function knowledgeDraftPayload(draft: KnowledgeDraft) {
  return {
    title: draft.title,
    content: draft.content,
    keywords: draft.keywords
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
    siteId: draft.siteId === "__global__" ? null : draft.siteId,
    enabled: draft.enabled,
  };
}

export function knowledgeDraftIsDirty(
  draft: KnowledgeDraft | null,
  activeEntry: KnowledgeRecord | null,
): boolean {
  if (!draft) return false;
  if (!activeEntry) {
    return Boolean(
      draft.title.trim() || draft.content.trim() || draft.keywords.trim(),
    );
  }
  return (
    activeEntry.title !== draft.title ||
    activeEntry.content !== draft.content ||
    activeEntry.enabled !== draft.enabled ||
    (activeEntry.siteId ?? "__global__") !== draft.siteId ||
    activeEntry.keywords.join(",") !==
      draft.keywords
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .join(",")
  );
}
