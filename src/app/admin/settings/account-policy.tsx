"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { callClientAction } from "@/lib/client-action";
import { saveAccountPolicyAction } from "@/server/actions/account-access";

export function AccountPolicy({
  required,
  smtpReady,
}: {
  required: boolean;
  smtpReady: boolean;
}) {
  const [enabled, setEnabled] = useState(required);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <Card className="shadow-none lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">账号与邮箱验证</CardTitle>
        <CardDescription>
          仅影响开启后通过入驻申请创建的账号，现有账号及管理员直接创建的账号可继续登录。邀请邮件已验证邮箱持有权。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="require-email-verification">
            新入驻账号必须验证邮箱
          </Label>
          <Switch
            id="require-email-verification"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={pending || (!smtpReady && !enabled)}
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {smtpReady
            ? "邮件服务已配置，请通过上方测试邮件确认可正常收信。"
            : "请先在上方保存 SMTP 配置，再开启验证或发送团队邀请。"}{" "}
          关闭开关不会更改已经要求验证的账号；这些账号可重新申请验证邮件，或通过管理员重置密码后解除验证限制。
        </p>
        <Button
          disabled={pending || enabled === required}
          onClick={async () => {
            setPending(true);
            const result = await callClientAction(
              () =>
                saveAccountPolicyAction({ requireEmailVerification: enabled }),
              "保存失败",
            );
            setPending(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(result.message ?? "已保存");
            router.refresh();
          }}
        >
          {pending ? "保存中…" : "保存账号策略"}
        </Button>
      </CardContent>
    </Card>
  );
}
