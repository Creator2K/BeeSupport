"use server";

import type { ActionResult } from "./result";
import {
  createSiteAction as createSite,
  updateSiteAction as updateSite,
} from "./site-edit";
import {
  deleteSiteAction as deleteSite,
  regenerateSiteKeyAction as regenerateSiteKey,
  toggleSiteActiveAction as toggleSiteActive,
} from "./site-lifecycle";
import type { SiteInput } from "./site-schemas";

export type { SiteInput } from "./site-schemas";

export async function createSiteAction(
  input: SiteInput,
): Promise<ActionResult & { siteId?: string }> {
  return createSite(input);
}

export async function updateSiteAction(
  id: string,
  input: SiteInput,
): Promise<ActionResult> {
  return updateSite(id, input);
}

export async function deleteSiteAction(id: string): Promise<ActionResult> {
  return deleteSite(id);
}

export async function regenerateSiteKeyAction(
  id: string,
): Promise<ActionResult & { publicKey?: string }> {
  return regenerateSiteKey(id);
}

export async function toggleSiteActiveAction(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  return toggleSiteActive(id, active);
}
