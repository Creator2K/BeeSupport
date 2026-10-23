import { test } from "node:test";
import assert from "node:assert/strict";
import { reporting as r, reportingService } from "./reporting-fixtures.mjs";
const now = new Date("2026-10-20T03:00:00Z");
const actor = {
  id: "admin",
  role: "MERCHANT_ADMIN",
  name: "管理员",
  tenantId: "own",
};
const input = { kind: "audit", from: "2026-10-01", to: "2026-10-20" };

test("CSV preserves Unicode, quotes and multiline cells, neutralizing spreadsheet formulas and control prefixes", () => {
  for (const value of [
    '=HYPERLINK("evil")',
    "+1+2",
    "-1+2",
    "@SUM(1)",
    "  =1",
    "\tordinary",
    "\rtext",
    "\ntext",
    "\u0000=1",
    "\uFEFF=1",
  ])
    assert.ok(r.csvCell(value).startsWith("\"'"), JSON.stringify(value));
  assert.equal(r.csvCell('中文,一"二\n三'), '"中文,一""二\n三"');
  assert.equal(r.csvCell(null), '""');
  assert.equal(r.csvCell("正常姓名"), '"正常姓名"');
  assert.equal(
    r.makeCsv(["名字", "金额"], [["张三", "0.01"]]),
    '\uFEFF"名字","金额"\r\n"张三","0.01"\r\n',
  );
});
test("report dates use inclusive Beijing calendar days, reject invalid and future dates, and cap at ninety days", () => {
  const range = r.reportDateRange("2026-10-01", "2026-10-20", now);
  assert.equal(range.gte.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-10-20T16:00:00.000Z");
  assert.equal(range.lte, now);
  assert.equal(
    r.reportTime(new Date("2026-10-19T16:00:00Z")),
    "2026-10-20 00:00:00",
  );
  assert.deepEqual(r.defaultReportDates(now), {
    from: "2026-09-21",
    to: "2026-10-20",
  });
  for (const [from, to] of [
    ["2026-02-29", "2026-03-01"],
    ["2026-13-01", "2026-13-02"],
    ["2026-10-20", "2026-10-19"],
    ["2026-10-21", "2026-10-21"],
    ["2026-01-01", "2026-10-20"],
    ["", ""],
  ])
    assert.throws(() => r.reportDateRange(from, to, now));
  assert.doesNotThrow(() => r.reportDateRange("2024-02-29", "2024-02-29", now));
  assert.doesNotThrow(() => r.reportDateRange("2026-07-23", "2026-10-20", now));
  assert.throws(() => r.reportDateRange("2026-07-22", "2026-10-20", now));
});
test("export input rejects forged tenant scopes, unrelated fields, unsupported kinds and unbounded search", () => {
  for (const data of [
    { ...input, tenantId: "other" },
    { ...input, kind: "users" },
    { ...input, query: "a".repeat(121) },
    { ...input, action: "<script>" },
    { ...input, status: "OPEN" },
  ])
    assert.equal(r.exportInputSchema.safeParse(data).success, false);
});
test("agents and missing merchant scopes fail before database access", async () => {
  const service = reportingService(
    new Proxy(
      {},
      {
        get() {
          throw Error("Unexpected database access");
        },
      },
    ),
  );
  for (const user of [
    { role: "AGENT", tenantId: "own" },
    { role: "MERCHANT_ADMIN" },
    { role: "unknown", tenantId: "own" },
  ]) {
    await assert.rejects(
      service.generateDataExport(user, input, undefined, now),
      { status: 403 },
    );
    await assert.rejects(
      service.getAuditRecords(user, { from: input.from, to: input.to }, 1, now),
      { status: 403 },
    );
  }
});
test("row limit and rate limiting fail without writing a download audit record", async () => {
  const tx = {
    auditLog: {
      count: async () => 5001,
      findMany: async () => {
        throw Error("Rows should not be loaded");
      },
      create: async () => {
        throw Error("Rejected export must not be audited as successful");
      },
    },
  };
  const db = { $transaction: async (callback) => callback(tx) };
  await assert.rejects(
    reportingService(db).generateDataExport(actor, input, undefined, now),
    { status: 413 },
  );
  await assert.rejects(
    reportingService(db, {
      rateLimit: async () => ({ ok: false }),
    }).generateDataExport(actor, input, undefined, now),
    { status: 429 },
  );
});
test("export audit failure aborts the export instead of returning an untracked file", async () => {
  let audit;
  const db = {
    $transaction: async (callback) =>
      callback({
        auditLog: {
          count: async () => 0,
          findMany: async () => [],
          create: async ({ data }) => {
            audit = data;
            throw Error("Audit storage unavailable");
          },
        },
      }),
  };
  await assert.rejects(
    reportingService(db).generateDataExport(
      actor,
      { ...input, query: "private keyword" },
      "127.0.0.1",
      now,
    ),
    /Audit storage unavailable/,
  );
  assert.equal(audit.action, "data.export");
  assert.equal(audit.tenantId, "own");
  assert.equal(audit.meta.queryApplied, true);
  assert.equal(JSON.stringify(audit).includes("private keyword"), false);
});
