"use client";

import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { AgentRecord, AgentSiteOption } from "./agent-types";

function StatusDot({
  status,
  t,
}: {
  status: "ONLINE" | "AWAY" | "OFFLINE";
  t: (
    key:
      | "workbench.statusOnline"
      | "workbench.statusAway"
      | "workbench.statusOffline",
  ) => string;
}) {
  const map = {
    ONLINE: { key: "workbench.statusOnline" as const, color: "bg-emerald-500" },
    AWAY: { key: "workbench.statusAway" as const, color: "bg-amber-500" },
    OFFLINE: { key: "workbench.statusOffline" as const, color: "bg-zinc-400" },
  };
  const item = map[status];
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span className={`size-1.5 rounded-full ${item.color}`} />
      {t(item.key)}
    </span>
  );
}

export function AgentTable({
  agents,
  sites,
  onCreate,
  onEdit,
  onReset,
  onDelete,
}: {
  agents: AgentRecord[];
  sites: AgentSiteOption[];
  onCreate: () => void;
  onEdit: (agent: AgentRecord) => void;
  onReset: (agent: AgentRecord) => void;
  onDelete: (agent: AgentRecord) => void;
}) {
  const t = useT();
  const siteName = (id: string) =>
    sites.find((site) => site.id === id)?.name ?? "—";

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {agents.length} {t("common.items")}
        </p>
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          <span className="ml-1.5">{t("agents.new")}</span>
        </Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title={t("common.empty")}
          description={t("agents.subtitle")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("agents.nameLabel")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("agents.role")}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t("agents.assignedSites")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("agents.currentStatus")}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {agent.name}
                      </div>
                      <div className="text-muted-foreground truncate text-xs">
                        {agent.email}
                      </div>
                      {agent.emailVerificationPending && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          待验证邮箱
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge
                      variant={agent.role === "ADMIN" ? "default" : "secondary"}
                    >
                      {agent.role === "ADMIN"
                        ? t("agents.roleAdmin")
                        : t("agents.roleAgent")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {agent.role === "ADMIN" ? (
                      <span className="text-muted-foreground text-xs">
                        {t("agents.allSitesHint")}
                      </span>
                    ) : agent.siteIds.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t("sites.noAgents")}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {agent.siteIds.slice(0, 3).map((id) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="text-[11px]"
                          >
                            {siteName(id)}
                          </Badge>
                        ))}
                        {agent.siteIds.length > 3 ? (
                          <span className="text-muted-foreground text-xs">
                            +{agent.siteIds.length - 3}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <StatusDot status={agent.status} t={t} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={agent.active ? "secondary" : "outline"}>
                      {agent.active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`管理 ${agent.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(agent)}>
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onReset(agent)}>
                          <KeyRound className="size-4" />
                          {t("agents.resetPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onDelete(agent)}
                        >
                          <Trash2 className="size-4" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
