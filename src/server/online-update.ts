import { randomUUID } from "node:crypto";
import { z } from "zod";

import { HttpError } from "../lib/auth";
import { prisma } from "../lib/db";
import { isNewerRelease, releaseTag, updateErrors, type UpdateError } from "../lib/online-update";

const settingKey = "platform.online-update";
const heartbeatTimeout = 90_000;
const claimTimeout = 45 * 60_000;
const jobSchema = z.object({
  id: z.uuid(),
  version: releaseTag,
  status: z.enum(["queued", "running", "success", "failed"]),
  changedAt: z.iso.datetime(),
  error: z.enum(Object.keys(updateErrors) as [UpdateError, ...UpdateError[]]).optional(),
});
const stateSchema = z.object({
  seenAt: z.iso.datetime().optional(),
  job: jobSchema.optional(),
});
type UpdateState = z.infer<typeof stateSchema>;

export async function readUpdateState(): Promise<UpdateState> {
  const stored = await prisma.setting.findUnique({ where: { key: settingKey } });
  return stateSchema.parse(stored?.value ?? {});
}

export function isUpdaterConnected(state: UpdateState) {
  return !!state.seenAt && Date.now() - Date.parse(state.seenAt) < heartbeatTimeout;
}

const active = (job: UpdateState["job"]) => job?.status === "queued" || job?.status === "running";

async function changeState<T>(change: (state: UpdateState, now: string) => T): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:online-update'))`;
    const stored = await tx.setting.findUnique({ where: { key: settingKey } });
    const state = stateSchema.parse(stored?.value ?? {});
    const output = change(state, new Date().toISOString());
    await tx.setting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, value: state },
      update: { value: state },
    });
    return output;
  });
}

export async function requestUpdate(version: string) {
  await changeState((state, now) => {
    if (active(state.job))
      throw new HttpError(409, "已有更新任务，请等待完成。");
    if (!isUpdaterConnected(state))
      throw new HttpError(409, "服务器更新程序未连接。");
    state.job = { id: randomUUID(), version, status: "queued", changedAt: now };
  });
}

export async function claimUpdate() {
  return changeState((state, now) => {
    state.seenAt = now;
    const job = state.job;
    if (!job || (job.status !== "queued" && (
      job.status !== "running" || Date.parse(now) - Date.parse(job.changedAt) < claimTimeout
    ))) return null;
    job.status = "running";
    job.changedAt = now;
    return { id: job.id, version: job.version };
  });
}

export async function finishUpdate(id: string, runningVersion: string, error?: UpdateError) {
  await changeState((state, now) => {
    const job = state.job;
    if (!job || job.id !== id || job.status !== "running") return;
    if (!error && job.version !== runningVersion)
      throw new Error("The installed version does not match the update request");
    state.seenAt = now;
    state.job = {
      ...job,
      status: error ? "failed" : "success",
      changedAt: now,
      ...(error ? { error } : {}),
    };
  });
}

export async function latestPublishedRelease(current: string, fresh = false) {
  try {
    const response = await fetch("https://api.github.com/repos/Creator2K/BeeSupport/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
      ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
    });
    if (!response.ok) return { available: false as const, update: null };
    const release = z.object({
      tag_name: releaseTag,
      draft: z.literal(false),
      prerelease: z.literal(false),
    }).parse(await response.json());
    const version = release.tag_name;
    return {
      available: true as const,
      update: isNewerRelease(version, current) ? {
        version,
        url: `https://github.com/Creator2K/BeeSupport/releases/tag/${version}`,
      } : null,
    };
  } catch {
    return { available: false as const, update: null };
  }
}
