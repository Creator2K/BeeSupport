import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";

const { deploymentWarnings } = loadModule("src/server/deployment-warnings.ts");

const events = (config) =>
  deploymentWarnings(config).map((warning) => warning.event);

const exampleDatabase =
  "postgresql://beesupport:beesupport@postgres:5432/beesupport?schema=public";
const ownDatabase =
  "postgresql://beesupport:Zx81kQ@postgres:5432/beesupport?schema=public";

test("development never reports deployment warnings", () => {
  assert.deepEqual(
    events({
      production: false,
      appUrl: "http://localhost:3000",
      databaseUrl: exampleDatabase,
    }),
    [],
  );
});

test("production reports a non-https APP_URL and the public database password", () => {
  assert.deepEqual(
    events({
      production: true,
      appUrl: "https://chat.example.com",
      databaseUrl: ownDatabase,
    }),
    [],
  );
  assert.deepEqual(
    events({
      production: true,
      appUrl: "http://192.168.1.20:3000",
      databaseUrl: ownDatabase,
    }),
    ["config.app_url_not_https"],
  );
  assert.deepEqual(
    events({ production: true, appUrl: undefined, databaseUrl: undefined }),
    ["config.app_url_not_https"],
  );
  assert.deepEqual(
    events({
      production: true,
      appUrl: "https://chat.example.com",
      databaseUrl: exampleDatabase,
    }),
    ["config.public_database_password"],
  );
  // 无法解析的地址不该让启动检查抛错
  assert.deepEqual(
    events({
      production: true,
      appUrl: "https://chat.example.com",
      databaseUrl: "not a url",
    }),
    [],
  );
});

test("warnings stay readable after the logger's secret redaction", () => {
  const { buildLogRecord } = loadModule("src/lib/logger.ts", {
    "../server/request-context": { getRequestContext: () => undefined },
  });
  const warnings = deploymentWarnings({
    production: true,
    appUrl: "http://192.168.1.20:3000",
    databaseUrl: exampleDatabase,
  });
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    // 与 server.ts 写日志的方式一致
    const record = buildLogRecord("warn", warning.event, {
      hint: warning.hint,
    });
    assert.equal(record.event, warning.event);
    assert.equal(record.hint, warning.hint);
  }
});
