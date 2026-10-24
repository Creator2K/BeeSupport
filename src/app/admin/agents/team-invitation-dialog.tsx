"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentSiteOption } from "./agent-types";
import type { TeamInvitationsController } from "./use-team-invitations";

export function TeamInvitationDialog({
  controller,
  team,
  sites,
}: {
  controller: TeamInvitationsController;
  team: string;
  sites: AgentSiteOption[];
}) {
  const {
    open,
    setOpen,
    pending,
    email,
    setEmail,
    role,
    setRole,
    siteIds,
    setSiteIds,
    send,
  } = controller;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>邮件邀请成员</DialogTitle>
          <DialogDescription>
            邀请加入「{team}」，有效期 72 小时。重新发送后，旧链接失效。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ email, role, siteIds });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">成员邮箱</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">团队角色</Label>
            <select
              id="invite-role"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="AGENT">客服（仅分配的站点）</option>
              <option value="MERCHANT_ADMIN">
                团队管理员（全部团队站点）
              </option>
            </select>
          </div>
          {role === "AGENT" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">分配站点</legend>
              {sites.length ? (
                sites.map((site) => (
                  <div className="flex items-center gap-2" key={site.id}>
                    <Checkbox
                      id={`invite-site-${site.id}`}
                      checked={siteIds.includes(site.id)}
                      onCheckedChange={(checked) =>
                        setSiteIds((previous) =>
                          checked
                            ? [...previous, site.id]
                            : previous.filter((id) => id !== site.id),
                        )
                      }
                    />
                    <Label
                      htmlFor={`invite-site-${site.id}`}
                      className="break-all text-sm font-normal"
                    >
                      {site.name}
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  当前团队尚无站点，可稍后分配。
                </p>
              )}
            </fieldset>
          )}
          <Button className="w-full" type="submit" disabled={pending}>
            {pending ? "提交中…" : "发送邀请邮件"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
