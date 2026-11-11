import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The app service has no env_file: the container only sees what app.environment
// lists. A setting the code reads but compose does not list is silently ignored
// in Docker deployments, however it is written in .env.

const compose = readFileSync("docker-compose.yml", "utf8");

// Only meaningful for local builds and dev servers.
const NOT_NEEDED_IN_CONTAINER = new Set(["NEXT_DIST_DIR"]);

function appEnvironmentKeys() {
  const lines = compose.split(/\r?\n/);
  const start = lines.indexOf("  app:");
  assert.notEqual(start, -1, "docker-compose.yml has no app service");
  const keys = new Set();
  let inEnvironment = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {0,2}\S/.test(line)) break;
    if (/^ {4}\S/.test(line)) {
      inEnvironment = line.trimEnd() === "    environment:";
      continue;
    }
    const match = inEnvironment && line.match(/^ {6}([A-Z][A-Z0-9_]*):/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function settingsReadByTheServer() {
  const names = new Map();
  const dynamicReaders = [];
  for (const file of ["server.ts", "next.config.ts", ...sourceFiles("src")]) {
    const text = readFileSync(file, "utf8");
    for (const [, name] of text.matchAll(
      /process\.env(?:\.|\[["'])([A-Z][A-Z0-9_]*)/g,
    ))
      names.set(name, file);
    if (/process\.env\[(?!["'])/.test(text)) dynamicReaders.push(file);
  }
  // src/lib/env.ts hands the whole environment to a schema; its keys are the names.
  const schemaKeys = [
    ...readFileSync("src/lib/env.ts", "utf8").matchAll(
      /^ {2}([A-Z][A-Z0-9_]*):/gm,
    ),
  ].map(([, name]) => name);
  assert.ok(schemaKeys.length >= 10, "could not read the schema in src/lib/env.ts");
  for (const name of schemaKeys) names.set(name, "src/lib/env.ts");
  // The socket cache intervals are looked up by name through a helper.
  const intervals = [
    ...readFileSync("src/server/socket-auth.ts", "utf8").matchAll(
      /ttlFromEnv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    ),
  ].map(([, name]) => name);
  assert.equal(intervals.length, 2, "could not read the socket cache intervals");
  for (const name of intervals) names.set(name, "src/server/socket-auth.ts");
  return { names, dynamicReaders, intervals };
}

test("docker-compose passes every setting the server reads into the app container", () => {
  const passed = appEnvironmentKeys();
  const { names, dynamicReaders } = settingsReadByTheServer();
  assert.ok(passed.size >= 20, "could not read app.environment");
  const missing = [...names]
    .filter(([name]) => !passed.has(name) && !NOT_NEEDED_IN_CONTAINER.has(name))
    .map(([name, file]) => `${name} (${file})`)
    .sort();
  assert.deepEqual(missing, [], "not listed under app.environment");
  // A new place that reads a setting by a computed name is invisible to the scan
  // above and has to be taught to settingsReadByTheServer.
  assert.deepEqual(dynamicReaders, ["src/server/socket-auth.ts"]);
});

test("docker-compose never passes the socket cache intervals as blank values", () => {
  // ttlFromEnv reads a blank string as 0, which re-checks identity and access
  // on every event instead of using the default interval.
  const { intervals } = settingsReadByTheServer();
  for (const name of intervals) {
    assert.match(
      compose,
      new RegExp(`^ {6}${name}: \\$\\{${name}:-[1-9]\\d*\\}$`, "m"),
      `${name} needs a non-blank default in docker-compose.yml`,
    );
  }
});
