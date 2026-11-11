import type { MessageKey } from "./i18n/dictionaries";

export type NavigationItem = {
  path: string;
  label: MessageKey;
  icon: string;
  count?: "merchants" | "orders" | "conversations" | "notices";
};
export type NavigationGroup = {
  id: string;
  label: MessageKey;
  defaultOpen: boolean;
  items: NavigationItem[];
};

export function adminNavigation(role: string): NavigationGroup[] {
  if (role !== "ADMIN" && role !== "MERCHANT_ADMIN") return [];
  const platform = role === "ADMIN";
  return [
    {
      id: "overview",
      label: "nav.workspace",
      defaultOpen: true,
      items: [
        { path: "", label: "nav.overview", icon: "overview" },
        ...(!platform
          ? [
              {
                path: "/onboarding",
                label: "nav.onboarding" as const,
                icon: "canned",
              },
            ]
          : []),
        {
          path: "/notifications",
          label: "nav.notifications",
          icon: "webhooks",
          count: "notices",
        },
      ],
    },
    ...(platform
      ? [
          {
            id: "operations",
            label: "nav.platformOperations" as const,
            defaultOpen: true,
            items: [
              {
                path: "/operations",
                label: "nav.operations" as const,
                icon: "overview",
              },
              {
                path: "/merchants",
                label: "nav.merchants" as const,
                icon: "merchants",
                count: "merchants" as const,
              },
              { path: "/plans", label: "nav.plans" as const, icon: "plans" },
              {
                path: "/orders",
                label: "nav.orders" as const,
                icon: "orders",
                count: "orders" as const,
              },
              {
                path: "/collection",
                label: "nav.collection" as const,
                icon: "plans",
              },
              {
                path: "/homepage",
                label: "nav.homepage" as const,
                icon: "branding",
              },
              {
                path: "/reminders",
                label: "nav.reminders" as const,
                icon: "webhooks",
              },
            ],
          },
        ]
      : []),
    {
      id: "support",
      label: "nav.customerService",
      defaultOpen: true,
      items: [
        {
          path: "/conversations",
          label: "nav.conversations",
          icon: "conversations",
          count: "conversations",
        },
        { path: "/follow-ups", label: "nav.followUps", icon: "webhooks" },
        { path: "/efficiency", label: "nav.efficiency", icon: "overview" },
        { path: "/visitors", label: "nav.visitors", icon: "visitors" },
        ...(platform
          ? [
              { path: "/sites", label: "nav.sites" as const, icon: "sites" },
              { path: "/agents", label: "nav.agents" as const, icon: "agents" },
            ]
          : []),
        { path: "/canned", label: "nav.canned", icon: "canned" },
      ],
    },
    ...(!platform
      ? [
          {
            id: "merchant",
            label: "nav.merchantManagement" as const,
            defaultOpen: true,
            items: [
              { path: "/sites", label: "nav.sites" as const, icon: "sites" },
              { path: "/agents", label: "nav.agents" as const, icon: "agents" },
              {
                path: "/organization",
                label: "nav.organization" as const,
                icon: "organization",
              },
              {
                path: "/subscription",
                label: "nav.subscription" as const,
                icon: "plans",
              },
            ],
          },
        ]
      : []),
    {
      id: "settings",
      label: platform ? "nav.platformSettings" : "nav.merchantSettings",
      defaultOpen: false,
      items: [
        { path: "/risk", label: "nav.risk", icon: "risk" },
        { path: "/webhooks", label: "nav.webhooks", icon: "webhooks" },
        { path: "/ai", label: "nav.ai", icon: "ai" },
        ...(platform
          ? [
              {
                path: "/branding",
                label: "nav.branding" as const,
                icon: "branding",
              },
              {
                path: "/settings",
                label: "nav.settings" as const,
                icon: "settings",
              },
              {
                path: "/deliveries",
                label: "nav.deliveries" as const,
                icon: "webhooks",
              },
            ]
          : []),
        { path: "/exports", label: "nav.exports", icon: "orders" },
        { path: "/audit", label: "nav.audit", icon: "audit" },
      ],
    },
  ];
}

export function navigationItemActive(
  pathname: string,
  basePath: string,
  path: string,
): boolean {
  // The custom server rewrites the public entry to /admin during SSR.
  // Match both forms so the first browser render agrees with the server.
  const publicPath =
    basePath !== "/admin" &&
    (pathname === "/admin" || pathname.startsWith("/admin/"))
      ? `${basePath}${pathname.slice("/admin".length)}`
      : pathname;
  const current = publicPath.replace(/\/+$/, "");
  const target = `${basePath}${path}`.replace(/\/+$/, "");
  return (
    current === target || (path !== "" && current.startsWith(`${target}/`))
  );
}
