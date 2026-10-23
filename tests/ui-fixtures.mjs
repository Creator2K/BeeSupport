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
const Dialog = element("div");
const DialogContent = element("div");
const DialogHeader = element("div");
const DialogTitle = element("h2");
const DialogDescription = element("p");
const AlertDialog = element("div");
const AlertDialogContent = element("div");
const AlertDialogHeader = element("div");
const AlertDialogTitle = element("h2");
const AlertDialogDescription = element("p");
const AlertDialogFooter = element("div");
const AlertDialogCancel = element("button");
const AlertDialogAction = element("button");
const Separator = element("hr");

const useT = () => (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const visitorPanelShared = loadModule(
  "src/components/agent/visitor-panel-shared.tsx",
  { "react/jsx-runtime": require("react/jsx-runtime") },
);

const toast = Object.assign(() => {}, {
  success() {},
  error() {},
  info() {},
  warning() {},
});

export const uiDependencies = {
  "react/jsx-runtime": require("react/jsx-runtime"),
  react: React,
  "lucide-react": icons,
  sonner: { toast },
  "next/navigation": {
    useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  },
  "@/components/locale-provider": { useT },
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
  "@/components/ui/button": { Button },
  "@/components/ui/input": { Input },
  "@/components/ui/textarea": { Textarea },
  "@/components/ui/label": { Label },
  "@/components/ui/badge": { Badge },
  "@/components/ui/switch": { Switch },
  "@/components/ui/separator": { Separator },
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
  "@/lib/launcher": { launcherForeground: () => "#ffffff" },
  "@/lib/format": {
    formatRelative: () => "2 minutes ago",
    formatDateTime: () => "2026-10-23 09:00",
  },
  "./visitor-panel-shared": visitorPanelShared,
  "@/lib/visitor-env": {
    describeVisitor: () => ({
      device: "Desktop",
      os: "Windows",
      browser: "Chrome",
    }),
  },
};

export function loadUiModule(filename) {
  return loadModule(filename, uiDependencies);
}

export function renderUi(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props));
}
