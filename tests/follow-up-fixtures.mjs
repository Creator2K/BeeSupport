import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const followUpPolicy = loadModule("src/lib/follow-ups.ts", {
  zod: { z },
});
export function followUpService(prisma, options = {}) {
  return loadModule("src/server/services/follow-ups.ts", {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/follow-ups": followUpPolicy,
  });
}
