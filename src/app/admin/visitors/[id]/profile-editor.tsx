"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callClientAction } from "@/lib/client-action";
import { saveVisitorProfileAction } from "@/server/actions/visitors";

export function ProfileEditor({
  visitor,
}: {
  visitor: {
    id: string;
    name: string | null;
    profileTags: string[];
    profileNote: string | null;
    blocked: boolean;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(visitor.name || "");
  const [tags, setTags] = useState(visitor.profileTags.join(", "));
  const [note, setNote] = useState(visitor.profileNote || "");
  const [blocked, setBlocked] = useState(visitor.blocked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        try {
          const result = await callClientAction(
            () =>
              saveVisitorProfileAction(visitor.id, {
                name,
                profileTags: tags
                  .split(/[,，\n]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                profileNote: note,
                blocked,
              }),
            "保存失败，请重试",
          );
          if (!result.ok) {
            setError(result.error);
            return;
          }
          toast.success("访客画像已保存");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      <h2 className="font-medium">维护画像</h2>
      <div className="space-y-2">
        <Label htmlFor="profile-name">姓名 / 昵称</Label>
        <Input
          id="profile-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-tags">访客标签</Label>
        <Input
          id="profile-tags"
          value={tags}
          maxLength={700}
          onChange={(e) => setTags(e.target.value)}
          placeholder="如：意向客户, 需要回访"
        />
        <p className="text-xs text-muted-foreground">
          逗号分隔，最多 20 个标签；跨该访客的会话保留。
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-note">画像备注</Label>
        <Textarea
          id="profile-note"
          rows={4}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="记录需求、跟进事项等"
        />
        <p className="text-xs text-muted-foreground">仅客服与管理员可见。</p>
      </div>
      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <input
          id="profile-blocked"
          type="checkbox"
          checked={blocked}
          onChange={(e) => setBlocked(e.target.checked)}
          className="mt-1"
        />
        <span>
          封禁此访客身份
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            保存后，该身份的现有会话立即断开。限制整个网络请使用 IP 封禁。
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存画像"}
      </Button>
    </form>
  );
}
