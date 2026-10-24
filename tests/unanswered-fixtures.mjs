import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";

export const unansweredPolicy = loadModule("src/lib/unanswered.ts", {
  zod: { z },
});

export function unansweredService(prisma, options = {}) {
  const dependencies = {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/unanswered": unansweredPolicy,
  };
  const scope = loadModule(
    "src/server/services/unanswered-scope.ts",
    dependencies,
  );
  const rules = loadModule("src/server/services/unanswered-rules.ts", {
    ...dependencies,
    "./unanswered-scope": scope,
  });
  const generation = loadModule(
    "src/server/services/unanswered-generation.ts",
    {
      ...dependencies,
      "./unanswered-scope": scope,
    },
  );
  const queries = loadModule("src/server/services/unanswered-queries.ts", {
    ...dependencies,
    "./unanswered-scope": scope,
  });
  const worker = loadModule("src/server/services/unanswered-worker.ts", {
    ...dependencies,
    "./unanswered-generation": generation,
  });
  return { ...rules, ...generation, ...queries, ...worker };
}
