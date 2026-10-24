"use client";

import { Button } from "@/components/ui/button";
import type { Invitation } from "./team-invitation-types";
import type { TeamInvitationsController } from "./use-team-invitations";

export function TeamInvitationList({
  controller,
  invitations,
  smtpReady,
}: {
  controller: TeamInvitationsController;
  invitations: Invitation[];
  smtpReady: boolean;
}) {
  const { pending, send, revoke } = controller;

  return (
    <div className="space-y-3">
      {!smtpReady && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          请联系平台管理员配置 SMTP
          邮件服务。当前仍可使用上方“新增账号”手动创建成员。
        </p>
      )}
      {invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无待接受的邀请</p>
      ) : (
        <ul className="space-y-3">
          {invitations.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0 text-sm">
                <p className="break-all font-medium">{invite.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invite.role === "AGENT" ? "客服" : "团队管理员"} · 到期{" "}
                  {new Date(invite.expiresAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || !smtpReady}
                  onClick={() =>
                    void send(
                      {
                        email: invite.email,
                        role:
                          invite.role === "MERCHANT_ADMIN"
                            ? "MERCHANT_ADMIN"
                            : "AGENT",
                        siteIds: invite.siteIds,
                      },
                      invite.id,
                    )
                  }
                >
                  重新发送
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => void revoke(invite.id)}
                >
                  撤销邀请
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
