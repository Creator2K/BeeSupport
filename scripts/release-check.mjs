import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { postgres } from "./recovery/postgres.mjs";

export async function checkMigrations(db, root = path.resolve("prisma/migrations")) {
  const applied = await db.json(`SELECT coalesce(json_agg(row_to_json(m)), '[]') FROM
    (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations) m`);
  if (applied.some((row) => !row.finished && !row.rolled_back)) throw new Error("Unfinished database migration.");
  const completed = applied.filter((row) => row.finished && !row.rolled_back);
  const local = (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort();
  if (local.length !== completed.length) throw new Error("Release and database migration counts differ.");
  for (const name of local) {
    const source = await readFile(path.join(root, name, "migration.sql"), "utf8");
    const lf = source.replaceAll("\r\n", "\n");
    const checksums = [source, lf, lf.replaceAll("\n", "\r\n")].map((text) => createHash("sha256").update(text).digest("hex"));
    if (!completed.some((item) => item.migration_name === name && checksums.includes(item.checksum))) throw new Error(`Release migration mismatch: ${name}`);
  }
  return { count: local.length, latest: local.at(-1) };
}

export async function releaseCheck({ url, adminPath, databaseUrl, container, migrationsRoot }) {
  const base = new URL(url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Supply an HTTP(S) application origin without credentials or a path.");
  if (!adminPath?.startsWith("/") || adminPath.startsWith("//") || /[?#\\]/.test(adminPath)) throw new Error("Supply --admin-path with the configured administrator route.");
  const checks = [];
  const get = (route) => fetch(new URL(route, base), { redirect: "manual", signal: AbortSignal.timeout(8000) });
  for (const route of ["/api/health", "/api/health/ready"]) {
    const response = await get(route);
    if (!response.ok || (await response.json()).status !== "ok") throw new Error(`Health check failed: ${route}`);
    checks.push(route);
  }
  const home = await get("/");
  if (!home.ok || !home.headers.get("content-type")?.includes("text/html")) throw new Error("Homepage check failed.");
  await home.body?.cancel();
  checks.push("homepage");
  const widget = await get("/widget.js");
  if (!widget.ok || !(await widget.text()).includes("BeeSupport")) throw new Error("Widget script check failed.");
  checks.push("widget-script");
  const admin = await get(adminPath);
  const location = admin.headers.get("location");
  if (![302, 303, 307, 308].includes(admin.status) || !location || new URL(location, base).pathname !== "/login") throw new Error("Administrator route did not require login.");
  await admin.body?.cancel();
  checks.push("admin-login-required");
  const socket = await get("/socket.io/?EIO=4&transport=polling");
  const handshake = await socket.text();
  if (!socket.ok || !handshake.startsWith("0{") || !JSON.parse(handshake.slice(1)).sid) throw new Error("Socket.IO handshake failed; start the custom server.");
  checks.push("socket-handshake");
  const migrations = await checkMigrations(postgres(databaseUrl, container), migrationsRoot);
  checks.push("migration-names-and-checksums");
  return { status: "passed", checkedAt: new Date().toISOString(), checks, migrations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { url: { type: "string" }, "admin-path": { type: "string" } } });
  releaseCheck({ url: values.url, adminPath: values["admin-path"], databaseUrl: process.env.RECOVERY_DATABASE_URL })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(`Release check failed: ${error.message}`); process.exitCode = 1; });
}
