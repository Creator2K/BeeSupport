import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

// No application .env fallback: an operator must choose the source/target explicitly.
export function databaseEnvironment(value) {
  if (!value) throw new Error("Set RECOVERY_DATABASE_URL explicitly; DATABASE_URL is never used.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid RECOVERY_DATABASE_URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username)
    throw new Error("RECOVERY_DATABASE_URL must specify a PostgreSQL host and user.");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database || /[\s/=\0]/.test(database)) throw new Error("Unsupported database name.");
  for (const key of url.searchParams.keys()) {
    if (!["schema", "sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout"].includes(key))
      throw new Error(`Unsupported database URL option: ${key}`);
  }
  if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public")
    throw new Error("Recovery currently requires the public application schema.");
  const env = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
    PGDATABASE: database, PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "beesupport-recovery", PGCLIENTENCODING: "UTF8",
    PGOPTIONS: "-c timezone=UTC -c statement_timeout=0 -c lock_timeout=10000",
  };
  for (const [option, variable] of Object.entries({ sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", connect_timeout: "PGCONNECT_TIMEOUT" })) {
    if (url.searchParams.has(option)) env[variable] = url.searchParams.get(option);
  }
  return env;
}

export function postgres(value, container = process.env.RECOVERY_PG_CONTAINER) {
  const connection = databaseEnvironment(value);
  // Do not inherit libpq settings that could redirect connections or execute startup SQL.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  Object.assign(env, connection);
  async function run(tool, args = [], { inputFile, outputFile, allowEarlyInputClose = false } = {}) {
    const command = container ? "docker" : tool;
    const argv = container
      ? ["exec", "-i", ...Object.keys(connection).flatMap((key) => ["-e", key]), container, tool, ...args]
      : args;
    const child = spawn(command, argv, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "", size = 0;
    // Database errors can contain credentials. Only the tool and exit code are reported.
    child.stderr.resume();
    const done = new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error(`Cannot start ${tool}; install PostgreSQL clients or set RECOVERY_PG_CONTAINER.`)));
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${tool} failed (exit ${code}); check connectivity, permissions and PostgreSQL client compatibility.`)));
    });
    const streams = [done];
    if (inputFile) streams.push(pipeline(createReadStream(inputFile), child.stdin).catch((error) => {
      // pg_restore --list reads only the archive TOC and may close stdin early.
      // A successful child exit is still required by `done`; real file IO failures remain fatal.
      if (allowEarlyInputClose && ["EPIPE", "ERR_STREAM_PREMATURE_CLOSE"].includes(error.code)) return;
      throw new Error(`${tool} input stream failed (${error.code || "unknown"}).`);
    }));
    else child.stdin.end();
    if (outputFile) streams.push(pipeline(child.stdout, createWriteStream(outputFile, { flags: "wx", mode: 0o600 })));
    else child.stdout.setEncoding("utf8").on("data", (bytes) => {
      size += Buffer.byteLength(bytes);
      if (size > 64 * 1024 * 1024) child.kill();
      else output += bytes.toString("utf8");
    });
    try { await Promise.all(streams); }
    catch (error) { child.kill(); await Promise.allSettled(streams); throw error; }
    return output.trim();
  }
  const sql = (query) => run("psql", ["-X", "--no-password", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query]);
  const json = async (query) => JSON.parse(await sql(query));
  return {
    database: connection.PGDATABASE,
    run, sql, json,
    async assertQuiet() {
      const count = Number(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"));
      if (count !== 0) throw new Error("Database has other sessions. Stop every app instance, worker and maintenance client first.");
    },
    async assertEmpty() {
      const count = Number(await sql(`SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
        (SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema')) +
        (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') +
        (SELECT count(*) FROM pg_largeobject_metadata) +
        (SELECT count(*) FROM pg_event_trigger)`));
      if (count !== 0) throw new Error("Restore target database is not empty. Existing objects are never overwritten.");
    },
    async snapshot() {
      const tables = await json(`SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.schema, t.name), '[]') FROM
        (SELECT schemaname AS schema, tablename AS name FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema') t`);
      const quote = (value) => `"${value.replaceAll('"', '""')}"`;
      for (const table of tables) table.rows = await sql(`SELECT count(*) FROM ${quote(table.schema)}.${quote(table.name)}`);
      const migrations = await json(`SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.migration_name), '[]') FROM
        (SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back FROM public._prisma_migrations) m`);
      if (migrations.some((row) => !row.finished && !row.rolled_back)) throw new Error("Database contains an unfinished migration; resolve it before backing up.");
      const attachments = await json(`SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.id), '[]') FROM
        (SELECT id, "storageKey", size FROM public."Attachment") a`);
      return { tables, migrations, attachments };
    },
  };
}
