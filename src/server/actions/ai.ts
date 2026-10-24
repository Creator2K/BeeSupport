"use server";

import type { ActionResult } from "./result";
import {
  listAiModelsAction as listAiModels,
  saveAiSettingsAction as saveAiSettings,
  testAiAction as testAi,
} from "./ai-settings";
import {
  createKnowledgeAction as createKnowledge,
  deleteKnowledgeAction as deleteKnowledge,
  updateKnowledgeAction as updateKnowledge,
} from "./ai-knowledge";
import {
  knowledgeIndexStatsAction as knowledgeIndexStats,
  rebuildKnowledgeIndexAction as rebuildKnowledgeIndex,
} from "./ai-knowledge-index";
import type {
  AiSettingsInput,
  KnowledgeInput,
} from "./ai-schemas";

export type { AiSettingsInput, KnowledgeInput } from "./ai-schemas";

export async function saveAiSettingsAction(
  input: AiSettingsInput,
): Promise<ActionResult> {
  return saveAiSettings(input);
}

export async function listAiModelsAction(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  return listAiModels(input);
}

export async function testAiAction(
  input: AiSettingsInput & { prompt: string },
): Promise<{ ok: boolean; text?: string; error?: string }> {
  return testAi(input);
}

export async function createKnowledgeAction(
  input: KnowledgeInput,
): Promise<ActionResult & { id?: string }> {
  return createKnowledge(input);
}

export async function updateKnowledgeAction(
  id: string,
  input: KnowledgeInput,
): Promise<ActionResult> {
  return updateKnowledge(id, input);
}

export async function deleteKnowledgeAction(id: string): Promise<ActionResult> {
  return deleteKnowledge(id);
}

export async function rebuildKnowledgeIndexAction(input?: {
  knowledgeId?: string;
  useEmbeddings?: boolean;
}): Promise<{
  ok: boolean;
  result?: {
    entries: number;
    chunks: number;
    embedded: number;
    vectorized: boolean;
    durationMs: number;
  };
  stats?: { entries: number; chunks: number; vectorized: number };
  error?: string;
}> {
  return rebuildKnowledgeIndex(input);
}

export async function knowledgeIndexStatsAction(): Promise<{
  entries: number;
  chunks: number;
  vectorized: number;
}> {
  return knowledgeIndexStats();
}
