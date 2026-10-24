import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const followUpPolicy = loadModule("src/lib/follow-ups.ts", {
  zod: { z },
});
export function followUpService(prisma, options = {}) {
  const dependencies = {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/follow-ups": followUpPolicy,
  };
  const access = loadModule(
    "src/server/services/follow-up-access.ts",
    dependencies,
  );
  const details = loadModule("src/server/services/follow-up-details.ts", {
    ...dependencies,
    "./follow-up-access": access,
  });
  const mutations = loadModule(
    "src/server/services/follow-up-mutations.ts",
    {
      ...dependencies,
      "./follow-up-access": access,
    },
  );
  const queries = loadModule("src/server/services/follow-up-queries.ts", {
    ...dependencies,
    "./follow-up-access": access,
  });
  return { ...details, ...mutations, ...queries };
}
