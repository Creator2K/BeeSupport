import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { useTestDatabase } from "../../scripts/test-environment.mjs";

useTestDatabase();
const { PrismaClient } = await import("@prisma/client");

test("upload cleanup preserves migrated Windows attachments and reports only genuine orphan files", async () => {
  const db = new PrismaClient();
  const root = await mkdtemp(path.join(tmpdir(), "beesupport-cleanup-test-"));
  const stamp = randomUUID();
  let site;
  try {
    site = await db.site.create({
      data: { name: "Storage regression", slug: `storage-${stamp}` },
    });
    const folder = path.join(root, site.id, "2026", "10");
    await mkdir(folder, { recursive: true });
    const old = new Date(Date.now() - 48 * 3600_000);
    for (let index = 0; index < 3; index++) {
      const filename = `${randomUUID()}.txt`;
      const file = path.join(folder, filename);
      await writeFile(file, "stored attachment");
      await utimes(file, old, old);
      const key = index === 0
        ? `${site.id}/2026/10/${filename}`
        : index === 1
          ? `${site.id}\\2026\\10/${filename}`
          : `${site.id}\\2026\\10\\${filename}`;
      await db.attachment.create({
        data: {
          siteId: site.id,
          uploader: "VISITOR",
          filename,
          mimeType: "text/plain",
          size: 17,
          storageKey: key,
        },
      });
    }
    const run = () => promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/cleanup-uploads.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          UPLOAD_DIR: root,
        },
        timeout: 30000,
      },
    );
    assert.match((await run()).stdout, /孤儿文件 0/);
    const orphan = path.join(folder, `${randomUUID()}.txt`);
    await writeFile(orphan, "orphan");
    await utimes(orphan, old, old);
    assert.match((await run()).stdout, /孤儿文件 1/);
  } finally {
    if (site) await db.site.delete({ where: { id: site.id } });
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
