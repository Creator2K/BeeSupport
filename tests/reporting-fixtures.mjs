import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const reporting = loadModule("src/lib/reporting.ts", { zod: { z } });
export function reportingService(prisma, options = {}) {
  return loadModule("src/server/services/reporting.ts", {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/reporting": reporting,
  });
}
