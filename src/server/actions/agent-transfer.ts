import { requireUser } from "@/lib/auth";
import { tenantDb } from "@/lib/tenant-db";

export async function listTransferTargetsAction(): Promise<
  { id: string; name: string; email: string; status: string }[]
> {
  const user = await requireUser();
  const prisma = tenantDb(user);
  const targets = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: user.id },
      OR:
        user.siteIds === null
          ? undefined
          : [
              { role: "MERCHANT_ADMIN" },
              { sites: { some: { siteId: { in: user.siteIds } } } },
            ],
    },
    select: { id: true, name: true, email: true, status: true },
    orderBy: { name: "asc" },
  });
  return targets;
}
