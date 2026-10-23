import { test } from "node:test";
import assert from "node:assert/strict";
import * as zod from "zod";
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
