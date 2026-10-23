import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
export const cannedPolicy = loadModule("src/lib/canned.ts", { zod: { z } });
export function cannedService(prisma) {
  return loadModule("src/server/services/canned.ts", {
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/canned": cannedPolicy,
  });
}
