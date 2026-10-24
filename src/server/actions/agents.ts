"use server";

import type { ActionResult } from "./result";
import {
  createAgentAction as createAgent,
} from "./agent-create";
import {
  updateAgentAction as updateAgent,
} from "./agent-update";
import {
  deleteAgentAction as deleteAgent,
  resetAgentPasswordAction as resetAgentPassword,
} from "./agent-account";
import { listTransferTargetsAction as listTransferTargets } from "./agent-transfer";
import type {
  CreateAgentInput,
  UpdateAgentInput,
} from "./agent-schemas";

export type {
  CreateAgentInput,
  UpdateAgentInput,
} from "./agent-schemas";

export async function createAgentAction(
  input: CreateAgentInput,
): Promise<ActionResult & { agentId?: string }> {
  return createAgent(input);
}

export async function updateAgentAction(
  id: string,
  input: UpdateAgentInput,
): Promise<ActionResult> {
  return updateAgent(id, input);
}

export async function resetAgentPasswordAction(
  id: string,
  newPassword: string,
): Promise<ActionResult> {
  return resetAgentPassword(id, newPassword);
}

export async function deleteAgentAction(id: string): Promise<ActionResult> {
  return deleteAgent(id);
}

export async function listTransferTargetsAction(): Promise<
  { id: string; name: string; email: string; status: string }[]
> {
  return listTransferTargets();
}
