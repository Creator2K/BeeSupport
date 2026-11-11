import { test } from "node:test";
import assert from "node:assert/strict";
import * as zod from "zod";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadModule } from "./load-module.mjs";

test("reporting time zones default to Shanghai, accept IANA names and fail fast for invalid configuration", () => {
  const keys = ["AUTH_SECRET", "DATABASE_URL", "REPORT_TIMEZONE", "NODE_ENV"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.AUTH_SECRET = "test-only-environment-secret-123456";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:55433/test";
    process.env.NODE_ENV = "test";
    const read = () =>
      loadModule("src/lib/env.ts", { zod, "dotenv/config": {} }).env;
    delete process.env.REPORT_TIMEZONE;
    assert.equal(read().REPORT_TIMEZONE, "Asia/Shanghai");
    for (const zone of ["UTC", "America/New_York", "Asia/Shanghai"]) {
      process.env.REPORT_TIMEZONE = zone;
      assert.equal(read().REPORT_TIMEZONE, zone);
    }
    process.env.REPORT_TIMEZONE = "invalid-time-zone";
    assert.throws(read, /REPORT_TIMEZONE/);
    process.env.REPORT_TIMEZONE = "+08:00";
    assert.throws(read, /REPORT_TIMEZONE/);
    process.env.REPORT_TIMEZONE = "GMT";
    assert.equal(read().REPORT_TIMEZONE, "UTC");
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("production refuses public placeholder and blank signing keys without disclosing their values", () => {
  const keys = [
    "AUTH_SECRET", "DATABASE_URL", "REPORT_TIMEZONE", "NODE_ENV", "NEXT_PHASE",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const example = readFileSync(".env.example", "utf8")
    .match(/^AUTH_SECRET="([^"]+)"/m)[1];
  const read = () =>
    loadModule("src/lib/env.ts", { zod, "dotenv/config": {} }).env;
  try {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:55433/test";
    process.env.REPORT_TIMEZONE = "UTC";
    process.env.NODE_ENV = "production";
    for (const secret of [
      example,
      ` ${example.toUpperCase()} `,
      "build-time-placeholder-secret-not-used-at-runtime",
      "ci-placeholder-secret-for-prisma-generate",
      " ".repeat(48),
    ]) {
      process.env.AUTH_SECRET = secret;
      // A build-phase marker must not become a production validation bypass.
      process.env.NEXT_PHASE = "phase-production-build";
      assert.throws(read, (error) => {
        assert.match(error.message, /AUTH_SECRET/);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    }
    const random = randomBytes(48).toString("hex");
    process.env.AUTH_SECRET = random;
    assert.equal(read().AUTH_SECRET, random);
    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;
      process.env.AUTH_SECRET = example;
      assert.equal(read().AUTH_SECRET, example);
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
