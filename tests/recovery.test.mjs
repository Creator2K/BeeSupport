import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { databaseEnvironment } from "../scripts/recovery/postgres.mjs";
import { portablePath, inventory, checkAttachments, digest, newDestination, nestedPath, validateInventory } from "../scripts/recovery/files.mjs";
import { backup, restore, verifyBackup } from "../scripts/recovery.mjs";
import { checkMigrations } from "../scripts/release-check.mjs";
import { createHash } from "node:crypto";

async function fixture(run) {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, "beesupport-recovery-unit-"));
  try { await run(root); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith("beesupport-recovery-unit-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("recovery never falls back to application credentials and handles encoded credentials", () => {
  assert.throws(() => databaseEnvironment(), /explicitly/);
  const env = databaseEnvironment("postgresql://user:p%40ss%3Aword@localhost:5432/recovery?schema=public&sslmode=require");
  assert.equal(env.PGPASSWORD, "p@ss:word");
  assert.equal(env.PGSSLMODE, "require");
  assert.equal(env.PGDATABASE, "recovery");
  assert.throws(() => databaseEnvironment("postgresql://u:p@localhost/db?host=elsewhere"), /Unsupported/);
  assert.throws(() => databaseEnvironment("postgresql://u:p@localhost/db?schema=private"), /public/);
});

test("backup paths reject traversal, alternate streams, case collisions and invalid manifest sizes", () => {
  for (const key of ["../x", "/x", "x/../y", "C:/x", "x\\y", "x//y", "x/nul.txt", "x/a.", "x/a ", "x\0y", "x/a?", "x/a*"]) assert.throws(() => portablePath(key));
  assert.equal(portablePath("site\\2026\\10/file.txt", true), "site/2026/10/file.txt");
  assert.throws(() => validateInventory([{ path: "a", bytes: -1, sha256: "f".repeat(64) }]));
  assert.throws(() => validateInventory(["a", "A"].map((name) => ({ path: name, bytes: 0, sha256: "f".repeat(64) }))));
  assert.ok(nestedPath(path.resolve("data"), path.resolve("data/a")));
  assert.ok(!nestedPath(path.resolve("data"), path.resolve("database/a")));
});

test("backup completeness requires every attachment, including legacy Windows keys", async () => fixture(async (root) => {
  await mkdir(path.join(root, "site"));
  await writeFile(path.join(root, "site", "test.txt"), "中文附件");
  const files = await inventory(root);
  checkAttachments([{ storageKey: "site\\test.txt", size: 12 }], files);
  assert.throws(() => checkAttachments([{ storageKey: "missing.txt", size: 12 }], files), /missing/);
  assert.throws(() => checkAttachments([{ storageKey: "site/test.txt", size: 2 }], files), /size/);
  await assert.rejects(newDestination(root), /already exists/);
}));

test("verification rejects corrupted dumps, changed uploads, extra files and incomplete backups", async () => fixture(async (root) => {
  await mkdir(path.join(root, "uploads"));
  await writeFile(path.join(root, "uploads", "test.txt"), "abc");
  await writeFile(path.join(root, "database.dump"), "test-dump");
  const manifest = { format: "beesupport-backup-v1", status: "complete", sourceDatabase: "source", snapshot: { attachments: [] },
    database: { bytes: 9, sha256: await digest(path.join(root, "database.dump")) }, files: await inventory(path.join(root, "uploads")) };
  await assert.rejects(verifyBackup(root), /ENOENT/);
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
  await verifyBackup(root);
  await writeFile(path.join(root, "database.dump"), "bad--dump");
  await assert.rejects(verifyBackup(root), /checksum/);
  await writeFile(path.join(root, "database.dump"), "test-dump");
  await writeFile(path.join(root, "uploads", "test.txt"), "abd");
  await assert.rejects(verifyBackup(root), /Backup files/);
  await writeFile(path.join(root, "uploads", "test.txt"), "abc");
  await writeFile(path.join(root, "uploads", "extra.txt"), "extra");
  await assert.rejects(verifyBackup(root), /Backup files/);
}));

test("backup requires stopped writers and refuses a nested output without touching the database", async () => fixture(async (root) => {
  await assert.rejects(backup({ uploads: root, output: `${root}-out` }), /quiesced/);
  await assert.rejects(backup({ uploads: root, output: path.join(root, "inside"), quiesced: true }), /separate/);
}));

test("recovery rejects directory junctions instead of copying outside the chosen root", async () => fixture(async (root) => {
  const source = path.join(root, "source"), outside = path.join(root, "outside");
  await mkdir(source); await mkdir(outside);
  await writeFile(path.join(outside, "private.txt"), "not an upload");
  await symlink(outside, path.join(source, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(inventory(source), /symbolic link/);
  assert.equal(await readFile(path.join(outside, "private.txt"), "utf8"), "not an upload");
}));

test("restore rejects a source database name before attempting any database mutation", async () => fixture(async (root) => {
  const bundle = path.join(root, "backup");
  await mkdir(bundle); await mkdir(path.join(bundle, "uploads"));
  await writeFile(path.join(bundle, "database.dump"), "test");
  await writeFile(path.join(bundle, "manifest.json"), JSON.stringify({ format: "beesupport-backup-v1", status: "complete", sourceDatabase: "source",
    snapshot: { attachments: [] }, files: [], database: { bytes: 4, sha256: await digest(path.join(bundle, "database.dump")) } }));
  await assert.rejects(restore({ databaseUrl: "postgresql://u:p@127.0.0.1:1/source", backup: bundle, uploads: path.join(root, "restored"), apply: true, quiesced: true }), /new database name/);
  await assert.rejects(newDestination(bundle), /already exists/);
}));

test("release verification accepts line-ending changes but rejects migration drift and unfinished migrations", async () => fixture(async (root) => {
  await mkdir(path.join(root, "first"));
  await writeFile(path.join(root, "first", "migration.sql"), "SELECT 1;\r\n");
  const applied = [{ migration_name: "first", checksum: createHash("sha256").update("SELECT 1;\n").digest("hex"), finished: true, rolled_back: false }];
  const db = { json: async () => applied };
  assert.equal((await checkMigrations(db, root)).count, 1);
  await writeFile(path.join(root, "first", "migration.sql"), "SELECT 2;\r\n");
  await assert.rejects(checkMigrations(db, root), /mismatch/);
  applied[0].finished = false;
  await assert.rejects(checkMigrations(db, root), /Unfinished/);
}));
