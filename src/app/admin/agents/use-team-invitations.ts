"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { callClientAction } from "@/lib/client-action";
import {
  inviteAgentAction,
  revokeAgentInvitationAction,
} from "@/server/actions/account-access";
import type { InviteInput, TeamInvitationRole } from "./team-invitation-types";

export function useTeamInvitations() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamInvitationRole>("AGENT");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  async function send(input: InviteInput, id?: string) {
    setPending(true);
    const result = await callClientAction(
      () => inviteAgentAction(input, id),
      "邀请失败，请稍后重试",
    );
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message ?? "邀请已提交");
    setOpen(false);
    setEmail("");
    setSiteIds([]);
    setRole("AGENT");
    router.refresh();
  }

  async function revoke(id: string) {
    setPending(true);
    const result = await callClientAction(
      () => revokeAgentInvitationAction(id),
      "撤销失败",
    );
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("邀请已撤销");
    router.refresh();
  }

  return {
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
    revoke,
  };
}

export type TeamInvitationsController = ReturnType<
  typeof useTeamInvitations
>;
