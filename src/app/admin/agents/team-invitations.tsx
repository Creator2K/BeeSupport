"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MailPlus } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { callClientAction } from "@/lib/client-action";
import {
  inviteAgentAction,
  revokeAgentInvitationAction,
} from "@/server/actions/account-access";

type Invitation = {
  id: string;
  email: string;
  role: string;
  siteIds: string[];
  expiresAt: string;
};
export function TeamInvitations({
  invitations,
  sites,
  team,
  smtpReady,
}: {
  invitations: Invitation[];
  sites: { id: string; name: string }[];
  team: string;
  smtpReady: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"AGENT" | "MERCHANT_ADMIN">("AGENT");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  async function send(
    input: {
      email: string;
      role: "AGENT" | "MERCHANT_ADMIN";
      siteIds: string[];
    },
    id?: string,
  ) {
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
                    onClick={async () => {
                      setPending(true);
                      const result = await callClientAction(
                        () => revokeAgentInvitationAction(invite.id),
                        "撤销失败",
                      );
                      setPending(false);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success("邀请已撤销");
                      router.refresh();
                    }}
                  >
                    撤销邀请
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
      </CardContent>
    </Card>
  );
}
