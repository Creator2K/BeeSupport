// Runs browser suites one after another and reports every failure at the end.
//
//   pnpm e2e:browser e2e:canned e2e:frontend ...
//
// Suites in SERVED expect the app at TEST_APP_URL; each gets a fresh production
// server so login rate limits and caches do not leak from one suite into the next.
// The account-access family (e2e:accounts, e2e:canned, ...) starts its own.
// Needs a production build and the environment the suites already expect
// (TEST_DATABASE_URL, AUTH_SECRET, ADMIN_PATH, ...). Server logs, uploads and
// screenshots go to test-results/<suite>/.
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SERVED = new Set([
  "e2e",
  "e2e:frontend",
  "e2e:features",
  "e2e:analytics-images",
  "e2e:tenants",
  "e2e:subscriptions",
  "e2e:demo-navigation",
  "e2e:home-launchers",
  "e2e:growth",
  "e2e:collection",
  "e2e:operations",
  "e2e:ai-queue",
  "e2e:ai-policy",
]);
// Scripts a suite needs run first. demo:seed leaves its demo merchants in the
// database on purpose (see README), so list e2e:demo-navigation last in a batch.
const SETUP = { "e2e:demo-navigation": ["demo:seed"] };
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;

const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const suites = process.argv.slice(2);
const unknown = suites.filter((name) => !/^[\w:-]+$/.test(name) || !scripts[name]);
if (suites.length === 0 || unknown.length > 0) {
  console.error(
    unknown.length > 0
      ? `Unknown suite: ${unknown.join(", ")}`
      : "Usage: pnpm e2e:browser <suite> [suite...]",
  );
  process.exit(2);
}

const appUrl = new URL(process.env.TEST_APP_URL || "http://127.0.0.1:3002");
const inCi = process.env.GITHUB_ACTIONS === "true";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const running = (child) => child.exitCode === null && child.signalCode === null;

function runScript(name, env) {
  return new Promise((resolve) => {
    // A single command string: script names are checked against package.json above.
    const child = spawn(`pnpm run ${name}`, { env, shell: true, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function stopServer(server) {
  if (!running(server)) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  const force = setTimeout(() => server.kill("SIGKILL"), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(force);
}

async function startServer(dir, env) {
  const log = createWriteStream(join(dir, "server.log"));
  const server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: {
      ...env,
      NODE_ENV: "production",
      PORT: appUrl.port || "80",
      BIND_HOST: appUrl.hostname,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && running(server)) {
    try {
      const response = await fetch(new URL("/api/health/ready", appUrl));
      if (response.ok) return server;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  await stopServer(server);
  throw new Error(`the app did not become ready on ${appUrl.origin}, see ${join(dir, "server.log")}`);
}

const results = [];
for (const name of suites) {
  const dir = join("test-results", name.replaceAll(":", "-"));
  mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    UPLOAD_DIR: join(dir, "uploads"),
    ACCOUNT_E2E_ARTIFACTS: dir,
    AI_POLICY_E2E_ARTIFACTS: dir,
    AI_QUEUE_E2E_ARTIFACTS: dir,
    FRONTEND_ARTIFACT_DIR: dir,
  };
  const started = Date.now();
  if (inCi) console.log(`::group::${name}`);
  else console.log(`\n=== ${name}`);
  let code = 1;
  let server = null;
  try {
    for (const setup of SETUP[name] ?? []) {
      const status = await runScript(setup, env);
      if (status !== 0) throw new Error(`${setup} exited with ${status}`);
    }
    if (SERVED.has(name)) server = await startServer(dir, env);
    code = await runScript(name, env);
  } catch (error) {
    console.error(`${name}: ${error.message}`);
  } finally {
    if (server) await stopServer(server);
  }
  if (inCi) console.log("::endgroup::");
  results.push({ name, code, seconds: Math.round((Date.now() - started) / 1000) });
  if (code !== 0 && inCi) console.log(`::error title=${name} failed::exit ${code}, artifacts in ${dir}`);
}

const lines = results.map(
  ({ name, code, seconds }) => `${code === 0 ? "PASS" : "FAIL"}  ${name}  ${seconds}s`,
);
console.log(`\nBrowser suites\n${lines.map((line) => `  ${line}`).join("\n")}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "| Suite | Result | Time |",
      "| --- | --- | --- |",
      ...results.map(
        ({ name, code, seconds }) =>
          `| \`${name}\` | ${code === 0 ? "pass" : `fail (exit ${code})`} | ${seconds}s |`,
      ),
      "",
    ].join("\n"),
  );
}
process.exit(results.some(({ code }) => code !== 0) ? 1 : 0);
