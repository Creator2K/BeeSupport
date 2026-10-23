import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const unansweredPolicy = loadModule("src/lib/unanswered.ts", {
  zod: { z },
});
export function unansweredService(prisma, options = {}) {
  return loadModule("src/server/services/unanswered.ts", {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/unanswered": unansweredPolicy,
  });
}
