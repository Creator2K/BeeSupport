import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";
import { reporting } from "./reporting-fixtures.mjs";
export const efficiencyPolicy = loadModule("src/lib/efficiency.ts", {
  zod: { z },
  "./reporting": reporting,
});
export function efficiencyService(prisma) {
  return loadModule("src/server/services/efficiency.ts", {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/efficiency": efficiencyPolicy,
  });
}
