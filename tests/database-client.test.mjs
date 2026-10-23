import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./load-module.mjs";

test("production server and separately bundled routes share one Prisma connection pool", () => {
  const saved = globalThis.__beePrisma;
  delete globalThis.__beePrisma;
  let connections = 0;
  class PrismaClient {
    constructor() {
      connections += 1;
    }
  }
  const dependencies = {
    "@prisma/client": { PrismaClient },
    "./env": { env: { NODE_ENV: "production" } },
  };
  try {
    const server = loadModule("src/lib/db.ts", dependencies);
    const route = loadModule("src/lib/db.ts", dependencies);
    const page = loadModule("src/lib/db.ts", dependencies);
    assert.equal(server.prisma, route.prisma);
    assert.equal(route.prisma, page.prisma);
    assert.equal(connections, 1);
  } finally {
    if (saved === undefined) delete globalThis.__beePrisma;
    else globalThis.__beePrisma = saved;
  }
});
