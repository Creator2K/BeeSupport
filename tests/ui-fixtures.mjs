import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

import { loadModule } from "./load-module.mjs";

const require = createRequire(import.meta.url);

const icon = (props) =>
  React.createElement("span", {
    "data-icon": "",
    "aria-hidden": "true",
    title: props?.title,
  });
const icons = new Proxy(
  {},
  {
    get: (_target, key) => (key === "__esModule" ? true : icon),
  },
);

const domProps = (tag, props = {}) => {
  const result = {};
  for (const key of [
    "id",
    "type",
    "role",
    "title",
    "placeholder",
    "value",
    "required",
    "disabled",
    "min",
    "max",
    "step",
    "rows",
    "className",
    "aria-label",
    "aria-checked",
  ]) {
    if (props[key] !== undefined) result[key] = props[key];
  }
  if (tag === "button" && result.type === undefined) result.type = "button";
  if ((tag === "input" || tag === "textarea") && result.value !== undefined)
    result.readOnly = true;
  return result;
};

const element =
  (tag) =>
  ({ children, ...props }) =>
    React.createElement(tag, domProps(tag, props), children);

const Button = element("button");
const Input = element("input");
const Textarea = element("textarea");
const Label = element("label");
const Badge = element("span");
const Switch = ({ checked, ...props }) =>
  React.createElement(
    "button",
    { ...domProps("button", props), "aria-checked": Boolean(checked) },
    checked ? "on" : "off",
  );

const Card = element("section");
const CardHeader = element("div");
const CardTitle = element("h2");
const CardDescription = element("p");
const CardAction = element("div");
const CardContent = element("div");
const Tabs = element("div");
const TabsList = element("div");
const TabsTrigger = element("button");
const TabsContent = element("div");
const Select = element("div");
const SelectTrigger = element("button");
const SelectValue = element("span");
const SelectContent = element("div");
const SelectItem = element("div");
const Popover = element("div");
const PopoverTrigger = element("div");
const PopoverContent = element("div");
const DropdownMenu = element("div");
const DropdownMenuTrigger = element("div");
const DropdownMenuContent = element("div");
const DropdownMenuItem = element("button");
const DropdownMenuLabel = element("div");
const DropdownMenuSeparator = element("hr");
const Sheet = element("div");
const SheetTrigger = element("div");
const SheetContent = element("div");
const SheetTitle = element("h2");
const Dialog = element("div");
const DialogContent = element("div");
const DialogHeader = element("div");
const DialogTitle = element("h2");
const DialogDescription = element("p");
const DialogFooter = element("div");
const AlertDialog = element("div");
const AlertDialogContent = element("div");
const AlertDialogHeader = element("div");
const AlertDialogTitle = element("h2");
const AlertDialogDescription = element("p");
const AlertDialogFooter = element("div");
const AlertDialogCancel = element("button");
const AlertDialogAction = element("button");
const Separator = element("hr");
const Checkbox = ({ checked, ...props }) =>
  React.createElement("button", {
    ...domProps("button", props),
    role: "checkbox",
    "aria-checked": Boolean(checked),
  });
const Table = element("table");
const TableHeader = element("thead");
const TableBody = element("tbody");
const TableRow = element("tr");
const TableHead = element("th");
const TableCell = element("td");

const useT = () => (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const adminNavigation = loadModule("src/lib/admin-navigation.ts");

const webhookTypes = loadModule(
  "src/app/admin/webhooks/webhook-types.ts",
);

const visitorPanelShared = loadModule(
  "src/components/agent/visitor-panel-shared.tsx",
  { "react/jsx-runtime": require("react/jsx-runtime") },
);

const visitorInsightsShared = loadModule(
  "src/components/admin/visitor-insights-shared.ts",
);
const brandingFields = loadModule(
  "src/components/admin/branding-fields.ts",
);
const brandingValue = loadModule("src/components/admin/branding-value.ts");
const riskUi = loadModule("src/app/admin/risk/risk-ui.ts");
const siteFormValues = loadModule(
  "src/app/admin/sites/site-form-values.ts",
);

const toast = Object.assign(() => {}, {
  success() {},
  error() {},
  info() {},
  warning() {},
});

export const uiDependencies = {
  "react/jsx-runtime": require("react/jsx-runtime"),
  "qrcode.react": {
    QRCodeSVG: ({ value }) =>
      React.createElement("div", { "data-qr": value }, "qr-code"),
  },
  react: React,
  "lucide-react": icons,
  sonner: { toast },
  "next/link": {
    __esModule: true,
    default: ({ href, children, ...props }) =>
      React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...domProps("a", props) },
        children,
      ),
  },
  "next/navigation": {
    useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
    usePathname: () => "/console-test/merchants",
  },
  "@/components/locale-provider": { useT, useLocale: () => ({ t: useT(), locale: "zh-CN" }) },
  "@/components/theme-toggle": {
    ThemeToggle: () => React.createElement("button", null, "theme"),
  },
  "@/components/language-switcher": {
    LanguageSwitcher: () => React.createElement("span", null, "language"),
  },
  "@/components/agent/notification-settings": {
    NotificationSettings: () => React.createElement("button", null, "notifications"),
  },
  "@/components/follow-ups/due-follow-ups": {
    DueFollowUps: () => React.createElement("span", null, "follow-ups"),
  },
  "@/components/follow-ups/follow-up-launcher": {
    FollowUpLauncher: () =>
      React.createElement("button", null, "follow-up-launcher"),
  },
  "@/components/emoji-picker": {
    EmojiPicker: () =>
      React.createElement("button", { "aria-label": "emoji" }, "emoji"),
  },
  "@/components/admin/page-header": {
    EmptyState: ({ title, description, action }) =>
      React.createElement(
        "section",
        null,
        React.createElement("h2", null, title),
        React.createElement("p", null, description),
        action,
      ),
  },
  "@/components/ui/sheet": {
    Sheet,
    SheetTrigger,
    SheetContent,
    SheetTitle,
  },
  "@/components/ui/button": { Button },
  "@/lib/chat-drafts": { clearAccountDrafts() {} },
  "@/components/ui/input": { Input },
  "@/components/ui/textarea": { Textarea },
  "@/components/ui/label": { Label },
  "@/components/ui/badge": { Badge },
  "@/components/ui/switch": { Switch },
  "@/components/ui/separator": { Separator },
  "@/components/ui/checkbox": { Checkbox },
  "@/components/ui/table": {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
  },
  "@/components/ui/card": {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardAction,
    CardContent,
  },
  "@/components/ui/tabs": { Tabs, TabsList, TabsTrigger, TabsContent },
  "@/components/ui/select": {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  },
  "@/components/ui/popover": { Popover, PopoverTrigger, PopoverContent },
  "@/components/ui/dropdown-menu": {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
  },
  "@/components/ui/dialog": {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  },
  "@/components/ui/alert-dialog": {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
  },
  "@/lib/utils": {
    cn: (...values) =>
      values
        .flat()
        .filter(Boolean)
        .join(" "),
  },
  "@/lib/launcher": {
    launcherForeground: () => "#ffffff",
    launcherStyleOptions: [
      {
        value: "bubble",
        label: "Classic bubble",
        description: "Balanced launcher",
      },
    ],
  },
  "@/components/widget/launcher-preview": {
    LauncherPreview: ({ style, label }) =>
      React.createElement(
        "span",
        { "data-launcher-style": style },
        `launcher:${label}`,
      ),
  },
  "@/components/admin/branding-editor": {
    BrandingEditor: () =>
      React.createElement("span", null, "branding-editor"),
  },
  "@/lib/clipboard": { copyText: async () => true },
  "@/lib/subscriptions": {
    formatPrice: (cents) => `?${(cents / 100).toFixed(2)}`,
    quotaConflict: (plan, usage) =>
      usage.agents > plan.maxAgents
        ? "Current usage exceeds the plan"
        : null,
    orderStatusLabels: {
      PENDING: "pending",
      CONFIRMED: "confirmed",
      REJECTED: "rejected",
      CANCELLED: "cancelled",
      EXPIRED: "expired",
    },
  },
  "@/server/actions/subscriptions": {
    decideOrderAction: async () => ({ ok: true, message: "ok" }),
    submitOrderAction: async () => ({ ok: true, message: "ok" }),
  },
  "@/server/actions/risk": {
    deleteRiskRuleAction: async () => ({ ok: true, message: "ok" }),
    saveRiskRuleAction: async () => ({ ok: true, message: "ok" }),
    setRiskRuleActiveAction: async () => ({
      ok: true,
      message: "ok",
      rule: { active: true, updatedAt: "2026-10-23T10:00:00.000Z" },
    }),
  },
  "@/server/actions/sites": {
    createSiteAction: async () => ({ ok: true, message: "ok" }),
    updateSiteAction: async () => ({ ok: true, message: "ok" }),
  },
  "@/server/actions/canned": {
    createCannedAction: async () => ({ ok: true, message: "ok" }),
    deleteCannedAction: async () => ({ ok: true, message: "ok" }),
    updateCannedAction: async () => ({ ok: true, message: "ok" }),
  },
  "./feature-summary": {
    FeatureSummary: () => React.createElement("span", null, "feature-summary"),
  },
  "./payment-report": {
    PaymentReport: () =>
      React.createElement("button", null, "payment-report"),
  },
  "@/lib/client-action": {
    callClientAction: async () => ({ ok: true, message: "ok" }),
  },
  "@/server/actions/webhooks": {
    createWebhookAction: async () => ({ ok: true }),
    updateWebhookAction: async () => ({ ok: true }),
    deleteWebhookAction: async () => ({ ok: true }),
    testWebhookAction: async () => ({ ok: true }),
    toggleWebhookAction: async () => ({ ok: true }),
  },
  "@/lib/format": {
    formatRelative: () => "2 minutes ago",
    formatDateTime: () => "2026-10-23 09:00",
    formatClock: () => "09:00:00",
    formatBytes: (bytes) => `${bytes} B`,
  },
  "@/lib/realtime/messages": {
    mergeMessages: (previous, next) => [...previous, ...next],
  },
  "@/lib/realtime/use-chat-scroll": {
    useChatScroll: () => ({
      scrollRef: { current: null },
      onScroll() {},
      preserveHistoryPosition() {},
    }),
  },
  "./visitor-panel-shared": visitorPanelShared,
  "./visitor-insights-shared": visitorInsightsShared,
  "./branding-fields": brandingFields,
  "./branding-value": brandingValue,
  "./risk-ui": riskUi,
  "./site-form-values": siteFormValues,
  "./webhook-types": webhookTypes,
  "@/lib/admin-navigation": adminNavigation,
  "@/lib/visitor-env": {
    describeVisitor: () => ({
      device: "Desktop",
      os: "Windows",
      browser: "Chrome",
    }),
  },
};

uiDependencies["./risk-pagination"] = loadModule(
  "src/app/admin/risk/risk-pagination.tsx",
  uiDependencies,
);

export function loadUiModule(filename) {
  return loadModule(filename, uiDependencies);
}

export function renderUi(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props));
}
