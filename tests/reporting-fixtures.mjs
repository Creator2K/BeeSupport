import { Prisma } from "@prisma/client";
import { z } from "zod";
import { loadModule, HttpError } from "./load-module.mjs";

export const reporting = loadModule("src/lib/reporting.ts", { zod: { z } });

export function reportingService(prisma, options = {}) {
  const dependencies = {
    "@prisma/client": { Prisma },
    "../../lib/auth": { HttpError },
    "../../lib/db": { prisma },
    "../../lib/rate-limit": {
      rateLimit: options.rateLimit ?? (async () => ({ ok: true })),
    },
    "../../lib/reporting": reporting,
  };
  const access = loadModule(
    "src/server/services/reporting-access.ts",
    dependencies,
  );
  const audit = loadModule("src/server/services/audit-report.ts", {
    ...dependencies,
    "./reporting-access": access,
  });
  const dataExport = loadModule("src/server/services/data-export.ts", {
    ...dependencies,
    "./reporting-access": access,
  });
  return { ...audit, ...dataExport };
}
