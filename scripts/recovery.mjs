import { mkdir, readFile, rename, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { postgres } from "./recovery/postgres.mjs";
import { assertEqual, checkAttachments, copyInventory, digest, inventory, nestedPath, newDestination, noLinks, validateInventory } from "./recovery/files.mjs";

export async function verifyBackup(directory) {
  const root = await noLinks(path.resolve(directory));
  await noLinks(path.join(root, "manifest.json"));
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.format !== "beesupport-backup-v1" || manifest.status !== "complete" || !manifest.sourceDatabase || !manifest.snapshot)
    throw new Error("Not a completed BeeSupport backup.");
  validateInventory(manifest.files);
  if (!Number.isSafeInteger(manifest.database.bytes) || !/^[a-f0-9]{64}$/.test(manifest.database.sha256)) throw new Error("Invalid database dump metadata.");
  const dump = await noLinks(path.join(root, "database.dump"));
  if (!(await lstat(dump)).isFile() || (await lstat(dump)).size !== manifest.database.bytes || await digest(dump) !== manifest.database.sha256)
    throw new Error("Database dump checksum mismatch.");
  assertEqual(await inventory(path.join(root, "uploads")), manifest.files, "Backup files");
  checkAttachments(manifest.snapshot.attachments, manifest.files);
  return manifest;
}

export async function backup({ databaseUrl, uploads, output, quiesced, release = "unspecified", container }) {
  if (!quiesced) throw new Error("Stop all writers, then pass --quiesced to make a consistent database and uploads backup.");
  const start = Date.now();
  const source = await noLinks(path.resolve(uploads));
  const target = await newDestination(output);
  if (nestedPath(source, target) || nestedPath(target, source)) throw new Error("Backup output and uploads must be separate directories.");
  const db = postgres(databaseUrl, container);
  await db.assertQuiet();
  const snapshot = await db.snapshot();
  const files = await inventory(source);
  checkAttachments(snapshot.attachments, files);
  await mkdir(target, { mode: 0o700 });
  await mkdir(path.join(target, "uploads"), { mode: 0o700 });
  // Missing manifest means incomplete; failure never turns a partial backup into a valid one.
  const dump = path.join(target, "database.dump");
  await db.run("pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-privileges", "--no-tablespaces"], { outputFile: dump });
  await db.run("pg_restore", ["--list"], { inputFile: dump, allowEarlyInputClose: true });
  await copyInventory(source, path.join(target, "uploads"), files);
  assertEqual(await inventory(source), files, "Source uploads after copying");
  assertEqual(await db.snapshot(), snapshot, "Source database after copying");
  await db.assertQuiet();
  const manifest = {
    format: "beesupport-backup-v1", status: "complete", createdAt: new Date().toISOString(),
    durationMs: Date.now() - start, sourceDatabase: db.database, release,
    postgresVersion: await db.sql("SHOW server_version"),
    dumpVersion: await db.run("pg_dump", ["--version"]),
    database: { bytes: (await lstat(dump)).size, sha256: await digest(dump) },
    snapshot, files,
  };
  const temporary = path.join(target, "manifest.partial.json");
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, path.join(target, "manifest.json"));
  return { status: "backed-up", directory: target, durationMs: Date.now() - start, files: files.length, attachments: snapshot.attachments.length, tables: snapshot.tables.length };
}

export async function restore({ databaseUrl, backup: directory, uploads, apply, quiesced, container }) {
  const start = Date.now();
  const root = path.resolve(directory);
  const manifest = await verifyBackup(root);
  const target = await newDestination(uploads);
  if (nestedPath(root, target) || nestedPath(target, root)) throw new Error("Restore uploads must be separate from the backup.");
  const db = postgres(databaseUrl, container);
  if (db.database === manifest.sourceDatabase) throw new Error("Restore requires a new database name, different from the backup source.");
  if (["postgres", "template0", "template1"].includes(db.database)) throw new Error("Cannot restore into a PostgreSQL maintenance database.");
  await db.assertQuiet();
  await db.assertEmpty();
  const plan = { status: "validated-plan", database: db.database, uploads: target, files: manifest.files.length, attachments: manifest.snapshot.attachments.length, tables: manifest.snapshot.tables.length, release: manifest.release };
  if (!apply) return { ...plan, next: "Keep all writers stopped; rerun with --apply --quiesced." };
  if (!quiesced) throw new Error("Pass --quiesced after stopping all writers before applying a restore.");
  await mkdir(target, { mode: 0o700 });
  await copyInventory(path.join(root, "uploads"), target, manifest.files);
  // Recheck immediately before mutation. Never issue DROP, --clean, --create or migrate.
  await db.assertQuiet();
  await db.assertEmpty();
  await db.run("pg_restore", ["--no-password", "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--no-tablespaces", "--dbname", db.database], { inputFile: path.join(root, "database.dump") });
  assertEqual(await db.snapshot(), manifest.snapshot, "Restored database");
  assertEqual(await inventory(target), manifest.files, "Restored uploads");
  return { ...plan, status: "restored-and-verified", durationMs: Date.now() - start, startApplication: "Use the matching release and separately secured configuration; keep outbound services isolated during drills." };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    uploads: { type: "string" }, output: { type: "string" }, backup: { type: "string" },
    release: { type: "string" }, quiesced: { type: "boolean" }, apply: { type: "boolean" }, help: { type: "boolean" },
  } });
  const command = positionals[0];
  if (values.help || !command) {
    console.log("BeeSupport recovery (requires PostgreSQL clients, or RECOVERY_PG_CONTAINER)\n" +
      "  backup --uploads <existing-dir> --output <new-dir> --quiesced [--release <immutable-ref>]\n" +
      "  verify --backup <backup-dir>\n" +
      "  restore --backup <backup-dir> --uploads <new-dir> [--apply --quiesced]\n" +
      "Set RECOVERY_DATABASE_URL explicitly for backup/restore. No .env is loaded; no files or databases are deleted.");
    return;
  }
  if (positionals.length !== 1) throw new Error("Expected exactly one command.");
  let result;
  if (command === "verify" && values.backup) {
    const manifest = await verifyBackup(values.backup);
    result = { status: "verified", files: manifest.files.length, attachments: manifest.snapshot.attachments.length, release: manifest.release };
  } else if (command === "backup" && values.uploads && values.output) {
    result = await backup({ ...values, databaseUrl: process.env.RECOVERY_DATABASE_URL });
  } else if (command === "restore" && values.backup && values.uploads) {
    result = await restore({ ...values, databaseUrl: process.env.RECOVERY_DATABASE_URL });
  } else throw new Error("Missing or invalid arguments; use --help.");
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Recovery failed: ${error.message}`); process.exitCode = 1; });
}
