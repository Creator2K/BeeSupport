"use client";

import { MailPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TeamInvitationDialog } from "./team-invitation-dialog";
import { TeamInvitationList } from "./team-invitation-list";
import type { Invitation } from "./team-invitation-types";
import type { AgentSiteOption } from "./agent-types";
import { useTeamInvitations } from "./use-team-invitations";

export function TeamInvitations({
  invitations,
  sites,
  team,
  smtpReady,
}: {
  invitations: Invitation[];
  sites: AgentSiteOption[];
  team: string;
  smtpReady: boolean;
}) {
  const controller = useTeamInvitations();
  const { pending, setOpen } = controller;

  return (
    <Card className="mt-6 shadow-none">
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">团队邀请</CardTitle>
          <CardDescription>
            邀请加入「{team}
            」，由成员自行设置密码。邀请不预占额度，接受时会再次检查可用账号数。
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!smtpReady || pending}
          onClick={() => setOpen(true)}
        >
          <MailPlus className="size-4" />
          邮件邀请成员
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <TeamInvitationList
          controller={controller}
          invitations={invitations}
          smtpReady={smtpReady}
        />
        <TeamInvitationDialog
          controller={controller}
          team={team}
          sites={sites}
        />
      </CardContent>
    </Card>
  );
}
