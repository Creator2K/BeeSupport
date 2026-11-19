import { readFile } from "node:fs/promises";

import { version as packageVersion } from "../../package.json";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";

export async function readImageRelease() {
  let contents: string;
  try {
    contents = await readFile("release.json", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const release: unknown = JSON.parse(contents);
  if (
    !release ||
    typeof release !== "object" ||
    !("version" in release) ||
    typeof release.version !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.version) ||
    !("commit" in release) ||
    typeof release.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(release.commit) ||
    !("builtAt" in release) ||
    typeof release.builtAt !== "string" ||
    !Number.isFinite(Date.parse(release.builtAt))
  ) {
    throw new Error("Invalid Docker release metadata");
  }
  return {
    version: release.version,
    commit: release.commit,
    builtAt: new Date(release.builtAt),
  };
}

export async function recordImageRelease() {
  const release = await readImageRelease();
  if (!release) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('beesupport:release-deployment'))`;
    const previous = await tx.releaseDeployment.findFirst({
      orderBy: { id: "desc" },
      select: { version: true, commit: true },
    });
    if (previous?.version === release.version && previous.commit === release.commit) return;
    await tx.releaseDeployment.create({ data: release });
  });
}

export async function getAppRelease() {
  const image = await readImageRelease().catch((error: unknown) => {
    logger.error("release.metadata_read_failed", {}, error);
    return null;
  });
  return { version: image?.version ?? `v${packageVersion}`, image };
}
