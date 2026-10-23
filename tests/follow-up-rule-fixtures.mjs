import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const rulePolicy = loadModule("src/lib/follow-up-rules.ts", {
  zod: { z },
});
export function followUpRuleService(prisma, options = {}) {
  return loadModule("src/server/services/follow-up-rules.ts", {
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/follow-up-rules": rulePolicy,
  });
}
