import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, nextTurn } from "./load-module.mjs";

const { createReadinessProbe } = loadModule("src/server/health.ts", {
  "../lib/db": { prisma: {} },
  "../lib/redis": { redisEnabled: false },
});

test("a single-instance installation is ready without optional Redis", async () => {
  const probe = createReadinessProbe({ database: async () => [] });
  assert.deepEqual(await probe(), {
    status: "ok",
    checks: { database: "ok", redis: "not_configured" },
  });
});

test("failed dependencies report unavailable without leaking connection details", async () => {
  const probe = createReadinessProbe({
    database: async () => {
      throw new Error("postgresql://user:secret@private-host/db");
    },
    redis: async () => {
      throw new Error("redis://:password@internal-host");
    },
  });
  const result = await probe();
  assert.deepEqual(result, {
    status: "unavailable",
    checks: { database: "error", redis: "error" },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|password|private-host|internal-host/,
  );
});

test("concurrent and immediately repeated probes share database and Redis work", async () => {
  let databaseCalls = 0;
  let redisCalls = 0;
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const probe = createReadinessProbe({
    database: async () => {
      databaseCalls += 1;
      await gate;
    },
    redis: async () => {
      redisCalls += 1;
      await gate;
    },
  });
  const responses = Array.from({ length: 20 }, () => probe());
  await nextTurn();
  assert.equal(databaseCalls, 1);
  assert.equal(redisCalls, 1);
  finish();
  assert.ok(
    (await Promise.all(responses)).every((result) => result.status === "ok"),
  );
  await probe();
  assert.equal(databaseCalls, 1);
  assert.equal(redisCalls, 1);
});

test("stalled database probes time out without filling the connection pool and recover once complete", async () => {
  let calls = 0;
  let finish;
  const probe = createReadinessProbe(
    {
      database: () => {
        calls += 1;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    { timeoutMs: 200, cacheMs: 0 },
  );
  assert.equal((await probe()).checks.database, "timeout");
  assert.equal((await probe()).checks.database, "timeout");
  assert.equal(calls, 1);
  finish();
  await nextTurn();
  const recovering = probe();
  await nextTurn();
  assert.equal(calls, 2);
  finish();
  assert.equal((await recovering).status, "ok");
});

test("configured Redis is required for readiness and is checked again after failure", async () => {
  let working = false;
  const probe = createReadinessProbe(
    {
      database: async () => [],
      redis: async () => {
        if (!working) throw new Error("offline");
        return "PONG";
      },
    },
    { cacheMs: 0 },
  );
  assert.deepEqual((await probe()).checks, { database: "ok", redis: "error" });
  working = true;
  assert.equal((await probe()).status, "ok");
});

test("liveness stays independent while the readiness endpoint returns 503 with no cache", async () => {
  class NextResponse extends Response {
    static json(data, init) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const live = loadModule("src/app/api/health/route.ts", {
    "next/server": { NextResponse },
  });
  const ready = loadModule("src/app/api/health/ready/route.ts", {
    "next/server": { NextResponse },
    "@/server/health": {
      checkReadiness: async () => ({
        status: "unavailable",
        checks: { database: "timeout", redis: "not_configured" },
      }),
    },
  });
  assert.equal((await live.GET()).status, 200);
  const response = await ready.GET();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).checks.database, "timeout");
});
