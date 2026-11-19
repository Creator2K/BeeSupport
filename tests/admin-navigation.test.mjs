import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";
const { adminNavigation, navigationItemActive } = loadModule(
  "src/lib/admin-navigation.ts",
);
test("platform navigation separates shared operations from personal merchant billing", () => {
  const groups = adminNavigation("ADMIN");
  const paths = groups.flatMap((group) => group.items.map((item) => item.path));
  for (const path of [
    "/merchants",
    "/orders",
    "/plans",
    "/branding",
    "/settings",
    "/releases",
    "/homepage",
    "/reminders",
    "/collection",
    "/operations",
    "/deliveries",
    "/exports",
    "/follow-ups",
    "/efficiency",
  ])
    assert.ok(paths.includes(path));
  assert.ok(!paths.includes("/organization"));
  assert.ok(!paths.includes("/subscription"));
  assert.ok(!paths.includes("/onboarding"));
  assert.ok(paths.includes("/notifications"));
  assert.equal(new Set(paths).size, paths.length);
});
test("merchant navigation excludes platform administration and keeps renewal access", () => {
  const paths = adminNavigation("MERCHANT_ADMIN").flatMap((group) =>
    group.items.map((item) => item.path),
  );
  for (const path of [
    "/merchants",
    "/orders",
    "/plans",
    "/branding",
    "/settings",
    "/releases",
    "/homepage",
    "/reminders",
    "/collection",
    "/operations",
    "/deliveries",
  ])
    assert.ok(!paths.includes(path));
  for (const path of [
    "/organization",
    "/subscription",
    "/sites",
    "/agents",
    "/risk",
    "/ai",
    "/onboarding",
    "/notifications",
    "/exports",
    "/follow-ups",
    "/efficiency",
  ])
    assert.ok(paths.includes(path));
  assert.deepEqual(adminNavigation("AGENT"), []);
  assert.deepEqual(adminNavigation("unknown"), []);
});
test("active navigation handles nested pages, trailing slashes and custom admin paths without prefix collisions", () => {
  assert.equal(
    navigationItemActive(
      "/console-demo/visitors/person",
      "/console-demo",
      "/visitors",
    ),
    true,
  );
  assert.equal(
    navigationItemActive(
      "/console-demo/visitors/",
      "/console-demo",
      "/visitors",
    ),
    true,
  );
  assert.equal(
    navigationItemActive(
      "/console-demo/visitors-else",
      "/console-demo",
      "/visitors",
    ),
    false,
  );
  assert.equal(
    navigationItemActive("/console-demo/sites", "/console-demo", ""),
    false,
  );
  assert.equal(
    navigationItemActive("/console-demo/", "/console-demo", ""),
    true,
  );
  assert.equal(
    navigationItemActive("/other/sites", "/console-demo", "/sites"),
    false,
  );
});
test("server rewritten paths and public paths select the same item during hydration", () => {
  for (const role of ["ADMIN", "MERCHANT_ADMIN"])
    for (const { items } of adminNavigation(role))
      for (const item of items) {
        const publicPath = `/console-demo${item.path}`;
        const internalPath = `/admin${item.path}`;
        assert.equal(
          navigationItemActive(internalPath, "/console-demo", item.path),
          navigationItemActive(publicPath, "/console-demo", item.path),
        );
        assert.equal(
          navigationItemActive(internalPath, "/console-demo", item.path),
          true,
        );
      }
  assert.equal(
    navigationItemActive("/admin-else/sites", "/console-demo", "/sites"),
    false,
  );
});
