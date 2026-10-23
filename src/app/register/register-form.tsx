"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { registerMerchantAction } from "@/server/actions/tenants";
import { callClientAction } from "@/lib/client-action";

export function RegisterForm() {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  if (result?.ok)
    return (
      <p
        role="status"
        className="rounded-lg border bg-muted p-5 text-sm leading-6"
      >
        {result.text}
      </p>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setResult(null);
        const response = await callClientAction(
          () => registerMerchantAction(form),
          "申请失败，请稍后重试",
        );
        setPending(false);
        setResult({
          ok: response.ok,
          text: response.ok
            ? (response.message ?? "申请已提交")
            : response.error,
        });
      }}
    >
      {(
        [
          ["name", "商家名称", "text"],
          ["slug", "商家标识（小写字母、数字、中划线）", "text"],
          ["ownerName", "管理员姓名", "text"],
          ["ownerEmail", "管理员邮箱", "email"],
          ["ownerPassword", "登录密码（至少 8 位）", "password"],
        ] as const
      ).map(([key, label, type]) => (
        <div className="space-y-1.5" key={key}>
          <Label htmlFor={`register-${key}`}>{label}</Label>
          <Input
            id={`register-${key}`}
            type={type}
            required
            minLength={key === "ownerPassword" ? 8 : key === "slug" ? 2 : 1}
            maxLength={key === "ownerPassword" ? 72 : key === "slug" ? 40 : 200}
            autoComplete={
              key === "ownerPassword"
                ? "new-password"
                : key === "ownerEmail"
                  ? "email"
                  : "off"
            }
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </div>
      ))}
      {result && (
        <p role="alert" className="text-sm text-destructive">
          {result.text}
        </p>
      )}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "提交中…" : "提交入驻申请"}
      </Button>
    </form>
  );
}
