import { test } from "node:test";
import assert from "node:assert/strict";

import { loadModule } from "./load-module.mjs";

const { createTtlCache } = loadModule("src/server/ttl-cache.ts");

test("TTL cache reuses values until expiry and supports forced refresh", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = createTtlCache({
    ttlMs: 100,
    now: () => now,
  });
  const load = async () => ++loads;

  assert.equal(await cache.getOrLoad("key", load), 1);
  assert.equal(await cache.getOrLoad("key", load), 1);
  assert.equal(loads, 1);

  now = 1_101;
  assert.equal(await cache.getOrLoad("key", load), 2);
  assert.equal(await cache.getOrLoad("key", load, true), 3);
  assert.equal(cache.size, 1);
});

test("TTL cache single-flights concurrent loads and caches null results", async () => {
  let loads = 0;
  let resolveLoad;
  const cache = createTtlCache({ ttlMs: 1_000 });
  const pendingLoad = () =>
    new Promise((resolve) => {
      loads += 1;
      resolveLoad = resolve;
    });

  const first = cache.getOrLoad("key", pendingLoad);
  const second = cache.getOrLoad("key", pendingLoad);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  resolveLoad(null);
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(cache.has("key"), true);
  assert.equal(await cache.getOrLoad("key", pendingLoad), null);
  assert.equal(loads, 1);
});

test("TTL cache evicts the oldest key when the entry limit is reached", () => {
  const cache = createTtlCache({ ttlMs: 1_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});
