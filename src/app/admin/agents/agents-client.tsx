"use client";

import { callClientAction } from "@/lib/client-action";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/admin/page-header";
import { useT } from "@/components/locale-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteAgentAction,
  resetAgentPasswordAction,
} from "@/server/actions/agents";

import { AgentFormDialog } from "./agent-form-dialog";

export type AgentRecord = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  active: boolean;
  status: "ONLINE" | "AWAY" | "OFFLINE";
  siteIds: string[];
  lastSeenAt: string | null;
  createdAt: string;
  emailVerificationPending?: boolean;
};

export type SiteOption = { id: string; name: string };

export function AgentsClient({
  agents,
  sites,
}: {
  agents: AgentRecord[];
  sites: SiteOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentRecord | null>(null);
  const [deleting, setDeleting] = useState<AgentRecord | null>(null);
  const [resetting, setResetting] = useState<AgentRecord | null>(null);

  const siteName = (id: string) =>
    sites.find((site) => site.id === id)?.name ?? "—";

  async function handleDelete() {
    if (!deleting) return;
    const result = await callClientAction(
      () => deleteAgentAction(deleting.id),
      t("common.operationFailed"),
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("agents.deleted"));
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t("common.total")} {agents.length} {t("common.items")}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
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
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(agent);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetting(agent)}>
                          <KeyRound className="size-4" />
                          {t("agents.resetPassword")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(agent)}
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

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={editing}
        sites={sites}
        onSaved={() => router.refresh()}
      />

      <ResetPasswordDialog
        agent={resetting}
        onClose={() => setResetting(null)}
        onDone={() => {
          setResetting(null);
          router.refresh();
        }}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agents.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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

function ResetPasswordDialog({
  agent,
  onClose,
  onDone,
}: {
  agent: AgentRecord | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent) return;
    setPending(true);
    const result = await callClientAction(
      () => resetAgentPasswordAction(agent.id, password),
      t("common.operationFailed"),
    );
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("agents.resetDone"));
    setPassword("");
    onDone();
  }

  return (
    <Dialog open={Boolean(agent)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("agents.resetPassword")}</DialogTitle>
          <DialogDescription>{agent?.email}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">{t("agents.newPassword")}</Label>
            <Input
              id="reset-password"
              type="text"
              value={password}
              minLength={8}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
