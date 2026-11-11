import "dotenv/config";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { deleteUpload } from "../src/lib/storage";

// Dry run by default. Only recognized upload paths older than a day are considered.
const apply = process.argv.includes("--apply");
const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
const root = path.resolve(env.UPLOAD_DIR);
const managedKey = /^[^/]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]+$/i;

async function* files(directory: string, prefix = ""): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    // Do not follow symlinks or inspect the bot's credential directory.
    if (entry.name === "wechatbot" || entry.isSymbolicLink()) continue;
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      yield* files(path.join(directory, entry.name), key);
    else if (entry.isFile() && managedKey.test(key)) yield key;
  }
}

async function main(): Promise<void> {
  let pending = 0;
  let orphaned = 0;
  let cursor: string | undefined;
  do {
    const batch = await prisma.attachment.findMany({
      where: { messageId: null, createdAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const attachment of batch) {
      pending += 1;
      if (apply) {
        const deleted = await prisma.attachment.deleteMany({
          where: {
            id: attachment.id,
            messageId: null,
            createdAt: { lt: cutoff },
          },
        });
        if (deleted.count) await deleteUpload(attachment.storageKey);
      }
    }
    cursor = batch.length === 500 ? batch.at(-1)!.id : undefined;
  } while (cursor);
  for await (const key of files(root)) {
    const info = await stat(path.join(root, key));
    if (info.mtime >= cutoff) continue;
    // Compare the portable key so historical Windows records are not deleted
    // as "orphans" after moving the uploads directory to Linux.
    const stored = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Attachment"
      WHERE replace("storageKey", chr(92), '/') = ${key}
      LIMIT 1
    `;
    if (stored.length) continue;
    orphaned += 1;
    if (apply) await deleteUpload(key);
  }
  console.log(
    `${apply ? "已清理" : "预览（未删除）"}：过期未发送附件 ${pending}，孤儿文件 ${orphaned}。`,
  );
  if (!apply) console.log("确认后运行 pnpm uploads:cleanup --apply 执行清理。");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
