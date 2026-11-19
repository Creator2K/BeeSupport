import "dotenv/config";

import { z } from "zod";
import { prisma } from "../src/lib/db";
import { updateErrors, type UpdateError } from "../src/lib/online-update";
import { claimUpdate, finishUpdate } from "../src/server/online-update";
import { readImageRelease } from "../src/server/release-deployment";

async function main() {
  const [command, id, result] = process.argv.slice(2);
  const release = await readImageRelease();
  if (!release) throw new Error("Online updates require a BeeSupport release image.");
  if (command === "version") {
    process.stdout.write(release.version + "\n");
    return;
  }
  if (command === "claim") {
    const job = await claimUpdate();
    if (job) process.stdout.write(`${job.id}\t${job.version}\t${release.version}\n`);
    return;
  }
  if (command === "finish" && (result === "success" || Object.hasOwn(updateErrors, result))) {
    await finishUpdate(z.uuid().parse(id), release.version, result === "success" ? undefined : result as UpdateError);
    return;
  }
  throw new Error("Invalid updater command");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
