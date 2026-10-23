import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { ADMIN_PATH } from "@/lib/app-paths";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { unreadNoticeCount } from "@/server/services/account-notices";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "AGENT") redirect("/agent");

  const [tenant, merchants, orders, conversations, notices] = await Promise.all(
    [
      user.role === "ADMIN"
        ? null
        : prisma.tenant.findUnique({
            where: { id: user.tenantId },
            select: { name: true },
          }),
      user.role === "ADMIN"
        ? prisma.tenant.count({ where: { status: "PENDING" } })
        : 0,
      user.role === "ADMIN"
        ? prisma.subscriptionOrder.count({
            where: { status: "PENDING", validUntil: { gt: new Date() } },
          })
        : 0,
      prisma.conversation.count({
        where: {
          status: "PENDING",
          ...(user.role === "ADMIN"
            ? {}
            : { site: { tenantId: user.tenantId } }),
        },
      }),
      unreadNoticeCount(user),
    ],
  );
  return (
    <AdminShell
      key={user.id}
      basePath={ADMIN_PATH}
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantExpired: user.tenantExpired,
        tenantName: tenant?.name,
        counts: { merchants, orders, conversations, notices },
      }}
    >
      {children}
    </AdminShell>
  );
}
