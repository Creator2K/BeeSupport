import { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/admin/page-header";
import { SubscriptionOrders } from "@/components/admin/subscription-orders";
import { ListPagination } from "@/components/admin/list-pagination";
import { Button } from "@/components/ui/button";
import { requirePlatformPage } from "@/lib/platform-page";
import { prisma } from "@/lib/db";
import { ADMIN_PATH } from "@/lib/app-paths";
import { orderStatusLabels } from "@/lib/subscriptions";
import { serializeSubscriptionOrder } from "@/server/services/subscriptions";
import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = { title: "订单审核" };
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPage();
  const params = await searchParams;
  const search =
    typeof params.search === "string" ? params.search.trim().slice(0, 120) : "";
  const status =
    typeof params.status === "string" && params.status in orderStatusLabels
      ? params.status
      : "";
  const pageSize = 20;
  const payment =
    params.payment === "reported" || params.payment === "unreported"
      ? params.payment
      : "";
  const now = new Date();
  const where: Prisma.SubscriptionOrderWhereInput = {
    AND: [
      payment === "reported"
        ? { paymentReportedAt: { not: null } }
        : payment === "unreported"
          ? { paymentReportedAt: null }
          : {},
      status === "PENDING"
        ? { status, validUntil: { gt: now } }
        : status === "EXPIRED"
          ? {
              OR: [
                { status: "EXPIRED" },
                { status: "PENDING", validUntil: { lte: now } },
              ],
            }
          : status
            ? { status }
            : {},
      search
        ? {
            OR: [
              { orderNo: { contains: search, mode: "insensitive" } },
              { tenant: { name: { contains: search, mode: "insensitive" } } },
              { tenant: { slug: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const total = await prisma.subscriptionOrder.count({ where });
  const page = Math.min(
    Math.max(1, Math.min(100000, Number(params.page) || 1)) | 0,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const orders = await prisma.subscriptionOrder.findMany({
    where,
    include: { tenant: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="订单审核"
        description="商家反馈的付款信息仅供核对。请核实实际到账后确认开通，套餐快照、处理人员和有效期变更均保留记录。"
      />
      <form className="flex flex-wrap gap-2">
        <input
          aria-label="搜索订单或商家"
          name="search"
          defaultValue={search}
          placeholder="订单号、商家名称或标识"
          className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
        />
        <select
          aria-label="订单状态"
          name="status"
          defaultValue={status}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部状态</option>
          {Object.entries(orderStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="付款反馈"
          name="payment"
          defaultValue={payment}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">全部付款反馈</option>
          <option value="reported">已反馈付款</option>
          <option value="unreported">未反馈付款</option>
        </select>
        <Button type="submit" variant="outline">
          搜索订单
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href={`${ADMIN_PATH}/collection`}>配置收款说明</Link>
        </Button>
      </form>
      <SubscriptionOrders
        orders={orders.map((order) => serializeSubscriptionOrder(order, true))}
        platform
      />
      <ListPagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={`${ADMIN_PATH}/orders`}
        filters={{ search, status, payment }}
      />
    </div>
  );
}
