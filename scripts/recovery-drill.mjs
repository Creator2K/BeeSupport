import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { useTestDatabase } from "./test-environment.mjs";
import { postgres } from "./recovery/postgres.mjs";
import { backup, restore, verifyBackup } from "./recovery.mjs";
import { releaseCheck } from "./release-check.mjs";

useTestDatabase();
const stamp = randomUUID().replaceAll("-", "");
const names = { source: `bs_drill_source_${stamp}`, target: `bs_drill_restore_${stamp}` };
if (process.env.RECOVERY_DRILL_OPS_IMAGE) names.ops = `bs_drill_ops_${stamp}`;
const created = [];
const artifacts = path.resolve(process.env.RECOVERY_DRILL_ARTIFACTS || "test-results/recovery");
await mkdir(artifacts, { recursive: true });
const temporaryParent = path.resolve(tmpdir());
const root = await mkdtemp(path.join(temporaryParent, "beesupport-recovery-drill-"));
const address = (name, forTools = false) => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  url.search = "";
  // The optional tool container is the explicitly selected test PostgreSQL container.
  if (forTools && process.env.RECOVERY_PG_CONTAINER) { url.hostname = "127.0.0.1"; url.port = "5432"; }
  return url.toString();
};
const admin = postgres(address(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1), true));
const authSecret = randomBytes(48).toString("hex");
const env = { ...process.env, AUTH_SECRET: authSecret, NODE_ENV: "production", REDIS_URL: "", WECHATBOT_ENABLED: "false",
  OPENAI_API_KEY: "", OPENAI_BASE_URL: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "",
  ADMIN_PATH: "/recovery-console", SEED_ADMIN_EMAIL: "admin@beesupport.local", SEED_ADMIN_PASSWORD: "RestoreDrill123!",
  SEED_AGENT_PASSWORD: "RestoreDrill123!", NEXT_TELEMETRY_DISABLED: "1", BIND_HOST: "127.0.0.1" };
const results = [];
const record = (name, detail = {}) => { results.push({ name, ok: true, ...detail }); console.log(`PASS ${name}`); };
const run = (args, extra, logName) => new Promise((resolve, reject) => {
  const log = createWriteStream(path.join(artifacts, logName));
  const child = spawn(process.execPath, args, { env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once("error", reject);
  child.once("close", (code) => log.end(() => code === 0 ? resolve() : reject(new Error(`${logName} failed; see the diagnostic log.`))));
});
// A Linux bind mount keeps the container's file ownership. The tools create owner-only directories,
// so they run as the invoking user; otherwise the drill could not read back or remove their output.
const invokingUser = typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
const runOps = (args, databaseUrl) => new Promise((resolve, reject) => {
  if (!process.env.RECOVERY_PG_CONTAINER) return reject(new Error("Container drill requires RECOVERY_PG_CONTAINER."));
  const child = spawn("docker", ["run", "--rm", ...invokingUser, "--network", `container:${process.env.RECOVERY_PG_CONTAINER}`,
    "-e", "RECOVERY_DATABASE_URL", "-v", `${root}:/fixtures`, process.env.RECOVERY_DRILL_OPS_IMAGE, ...args],
  { env: { ...process.env, RECOVERY_DATABASE_URL: databaseUrl }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", diagnostic = "";
  child.stdout.setEncoding("utf8").on("data", (data) => { output += data; });
  child.stderr.setEncoding("utf8").on("data", (data) => { diagnostic = (diagnostic + data).slice(-16000); });
  child.once("error", reject);
  child.once("close", (code) => {
    writeFile(path.join(artifacts, `container-${args[0]}.log`), `${output}\n${diagnostic}`).then(() => {
      try {
        if (code === 0) resolve(JSON.parse(output));
        else reject(new Error(`Ops container ${args[0]} failed (exit ${code}); see container-${args[0]}.log.`));
      } catch (error) { reject(error); }
    }, reject);
  });
});
let app, appLog, client, appFinished, appStartError;
let failure;
try {
  for (const name of Object.values(names)) {
    assert.match(name, /^bs_drill_(source|restore|ops)_[a-f0-9]{32}$/);
    await admin.sql(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  const sourceUrl = address(names.source), targetUrl = address(names.target);
  const sourceTools = address(names.source, true), targetTools = address(names.target, true);
  const sourceUploads = path.join(root, "source-uploads");
  const restoredUploads = path.join(root, "restored-uploads");
  const bundle = path.join(root, "backup");
  await mkdir(sourceUploads);
  const sourceEnv = { DATABASE_URL: sourceUrl, UPLOAD_DIR: sourceUploads, APP_URL: "http://127.0.0.1:3000" };
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], sourceEnv, "migrations.log");
  await run(["--import", "tsx", "prisma/seed.ts"], sourceEnv, "seed.log");
  client = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const site = await client.site.findUniqueOrThrow({ where: { slug: "demo" } });
  const message = await client.message.findFirstOrThrow({ where: { conversation: { siteId: site.id } } });
  await client.message.update({ where: { id: message.id }, data: { body: "恢复演练：中文消息、退款记录与历史附件。" } });
  const bytes = Buffer.concat([Buffer.from("BeeSupport 恢复附件\n"), randomBytes(256)]);
  const key = `${site.id}/2026/10/restore.bin`;
  await mkdir(path.dirname(path.join(sourceUploads, key)), { recursive: true });
  await writeFile(path.join(sourceUploads, key), bytes);
  await writeFile(path.join(sourceUploads, "orphan.txt"), "Preserve unreferenced uploads too.");
  const attachment = await client.attachment.create({ data: {
    siteId: site.id, messageId: message.id, uploader: "VISITOR", filename: "恢复附件.bin", mimeType: "application/octet-stream",
    size: bytes.length, storageKey: key.replaceAll("/", "\\"),
  } });
  await assert.rejects(backup({ databaseUrl: sourceTools, uploads: sourceUploads, output: bundle, quiesced: true }), /other sessions/);
  record("backup refuses an active application connection");
  await client.$disconnect(); client = null;

  const saved = await backup({ databaseUrl: sourceTools, uploads: sourceUploads, output: bundle, quiesced: true, release: "recovery-drill" });
  record("consistent backup includes database, migration history and both referenced and orphan uploads", { durationMs: saved.durationMs, files: saved.files });
  const manifest = await verifyBackup(bundle);
  const manifestText = await readFile(path.join(bundle, "manifest.json"), "utf8");
  assert.ok(!manifestText.includes(authSecret));
  assert.ok(!manifestText.includes(decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).password)));
  const migrationCount = (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
  assert.equal(manifest.snapshot.migrations.filter((item) => item.finished && !item.rolled_back).length, migrationCount);
  const options = { databaseUrl: targetTools, backup: bundle, uploads: restoredUploads };
  const plan = await restore(options);
  assert.equal(plan.status, "validated-plan");
  await assert.rejects(lstat(restoredUploads), /ENOENT/);
  await postgres(targetTools).assertEmpty();
  record("default restore validates without creating files or database objects");

  if (names.ops) {
    await runOps(["backup", "--uploads", "/fixtures/source-uploads", "--output", "/fixtures/container-backup", "--quiesced", "--release", "container-drill"], sourceTools);
    const checked = await runOps(["verify", "--backup", "/fixtures/container-backup"], sourceTools);
    assert.equal(checked.status, "verified");
    const dockerRestore = await runOps(["restore", "--backup", "/fixtures/container-backup", "--uploads", "/fixtures/container-restored", "--apply", "--quiesced"], address(names.ops, true));
    assert.equal(dockerRestore.status, "restored-and-verified");
    assert.deepEqual(await readFile(path.join(root, "container-restored", key)), bytes);
    record("operations image performs a complete backup, verification and restore", { durationMs: dockerRestore.durationMs });
  }

  const dump = path.join(bundle, "database.dump");
  const originalDump = await readFile(dump);
  const damaged = Buffer.from(originalDump); damaged[damaged.length - 1] ^= 1;
  await writeFile(dump, damaged);
  await assert.rejects(restore({ ...options, apply: true, quiesced: true }), /checksum/);
  await postgres(targetTools).assertEmpty();
  await writeFile(dump, originalDump);
  record("corrupted dump is rejected before any target mutation");
  const targetDb = postgres(targetTools);
  await targetDb.sql("CREATE TABLE restore_guard (id integer)");
  await assert.rejects(restore({ ...options, apply: true, quiesced: true }), /not empty/);
  await targetDb.sql("DROP TABLE restore_guard");
  await targetDb.sql("CREATE SCHEMA pgcustom");
  await assert.rejects(restore({ ...options, apply: true, quiesced: true }), /not empty/);
  await targetDb.sql("DROP SCHEMA pgcustom");
  record("non-empty destination database is preserved");

  const restored = await restore({ ...options, apply: true, quiesced: true });
  record("restore verifies all table counts, migrations, attachment references and SHA-256 hashes", { durationMs: restored.durationMs, tables: restored.tables });
  assert.deepEqual(await readFile(path.join(restoredUploads, key)), bytes);
  client = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  assert.equal((await client.message.findUniqueOrThrow({ where: { id: message.id } })).body, "恢复演练：中文消息、退款记录与历史附件。");
  assert.equal((await client.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).filename, "恢复附件.bin");
  await client.$disconnect(); client = null;
  await assert.rejects(restore({ ...options, apply: true, quiesced: true }), /already exists/);
  record("restored Unicode content and binary files match; repeated restore cannot overwrite them");

  if (process.env.RECOVERY_DRILL_BUILD) {
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const appUrl = `http://127.0.0.1:${port}`;
    const restoredEnv = { ...env, DATABASE_URL: targetUrl, TEST_DATABASE_URL: targetUrl, UPLOAD_DIR: restoredUploads,
      APP_URL: appUrl, TEST_APP_URL: appUrl, PORT: String(port), NEXT_DIST_DIR: process.env.RECOVERY_DRILL_BUILD };
    appLog = createWriteStream(path.join(artifacts, "restored-server.log"));
    app = spawn(process.execPath, ["--import", "tsx", "server.ts"], { env: restoredEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    appFinished = new Promise((resolve) => app.once("close", resolve));
    app.once("error", (error) => { appStartError = error; });
    app.stdout.pipe(appLog, { end: false }); app.stderr.pipe(appLog, { end: false });
    let ready = false;
    for (let index = 0; index < 90; index++) {
      if (appStartError || app.exitCode !== null || app.signalCode !== null) throw new Error("Restored application exited before readiness.");
      try { if ((await fetch(`${appUrl}/api/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await delay(1000);
    }
    if (!ready) throw new Error("Restored application readiness timed out.");
    const releaseResult = await releaseCheck({ url: appUrl, adminPath: env.ADMIN_PATH, databaseUrl: targetTools });
    await writeFile(path.join(artifacts, "release-check.json"), `${JSON.stringify(releaseResult, null, 2)}\n`);
    record("restored production app passes health, widget, login protection, Socket.IO and migration checks");
    const login = await fetch(`${appUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
    const history = await fetch(`${appUrl}/api/agent/conversations/${message.conversationId}`, { headers: { cookie } });
    assert.equal(history.status, 200);
    assert.ok((await history.json()).messages.some((item) => item.id === message.id && item.body === "恢复演练：中文消息、退款记录与历史附件。"));
    const restoredFile = await fetch(`${appUrl}/api/files/${attachment.id}`, { headers: { cookie } });
    assert.equal(restoredFile.status, 200);
    assert.deepEqual(Buffer.from(await restoredFile.arrayBuffer()), bytes);
    record("administrator can read the restored historical message and download its original attachment");
    await run(["scripts/e2e.mjs"], restoredEnv, "restored-e2e.log");
    record("restored application passes all 65 core end-to-end checks");
  }
} catch (error) {
  failure = error;
  console.error(error.message);
} finally {
  if (client) await client.$disconnect();
  if (app && app.exitCode === null && app.signalCode === null) {
    app.kill("SIGTERM");
    for (let index = 0; index < 100 && app.exitCode === null && app.signalCode === null; index++) await delay(100);
    if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL");
  }
  if (appFinished) await appFinished;
  appLog?.end();
  for (const name of created.reverse()) {
    assert.ok(Object.values(names).includes(name));
    await admin.sql(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  assert.equal(path.dirname(path.resolve(root)), temporaryParent);
  assert.ok(path.basename(root).startsWith("beesupport-recovery-drill-"));
  await rm(root, { recursive: true, force: true });
  await writeFile(path.join(artifacts, "results.json"), `${JSON.stringify({ status: failure ? "failed" : "passed", results, cleanup: "temporary databases, uploads and restored app removed", error: failure?.message }, null, 2)}\n`);
}
if (failure) process.exitCode = 1;
