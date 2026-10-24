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
  const auditReport = loadModule("src/server/services/audit-report.ts", {
    ...dependencies,
    "./reporting-access": access,
  });
  const exportTypes = loadModule(
    "src/server/services/data-export-types.ts",
    dependencies,
  );
  const conversations = loadModule(
    "src/server/services/data-export-conversations.ts",
    {
      ...dependencies,
      "./data-export-types": exportTypes,
    },
  );
  const orders = loadModule(
    "src/server/services/data-export-orders.ts",
    {
      ...dependencies,
      "./data-export-types": exportTypes,
    },
  );
  const auditExport = loadModule(
    "src/server/services/data-export-audit.ts",
    {
      ...dependencies,
      "./data-export-types": exportTypes,
      "./reporting-access": access,
    },
  );
  const dataExport = loadModule("src/server/services/data-export.ts", {
    ...dependencies,
    "./reporting-access": access,
    "./data-export-types": exportTypes,
    "./data-export-conversations": conversations,
    "./data-export-orders": orders,
    "./data-export-audit": auditExport,
  });
  return { ...auditReport, ...dataExport };
}
