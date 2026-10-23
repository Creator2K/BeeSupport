"use client";

import { Check, Plus, X } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type VisitorConversationFieldsProps = {
  subject: string;
  tags: string[];
  tagDraft: string;
  note: string;
  priority: string;
  rating: number | null | undefined;
  ratingComment: string | null | undefined;
  pending: boolean;
  onSubjectChange: (value: string) => void;
  onSaveSubject: () => void;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onPriorityChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
};

export function VisitorConversationFields({
  subject,
  tags,
  tagDraft,
  note,
  priority,
  rating,
  ratingComment,
  pending,
  onSubjectChange,
  onSaveSubject,
  onTagDraftChange,
  onAddTag,
  onRemoveTag,
  onPriorityChange,
  onNoteChange,
  onSaveNote,
}: VisitorConversationFieldsProps) {
  const t = useT();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="conversation-subject" className="text-xs">
          {t("common.subject")}
        </Label>
        <div className="flex gap-1.5">
          <Input
            id="conversation-subject"
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("common.save")}
            disabled={pending}
            onClick={onSaveSubject}
          >
            <Check className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("common.tags")}</Label>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 text-[11px]">
              {tag}
              <button
                type="button"
                disabled={pending}
                aria-label={`${t("common.delete")}: ${tag}`}
                onClick={() => onRemoveTag(tag)}
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={tagDraft}
            onChange={(event) => onTagDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAddTag();
              }
            }}
            placeholder={t("workbench.tagsPlaceholder")}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={pending}
            aria-label={t("common.tags")}
            onClick={onAddTag}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("workbench.priorityLabel")}</Label>
        <Select value={priority} onValueChange={onPriorityChange}>
          <SelectTrigger
            size="sm"
            className="w-full"
            disabled={pending}
            aria-label={t("workbench.priorityLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("common.none")}</SelectItem>
            <SelectItem value="1">P1</SelectItem>
            <SelectItem value="2">P2</SelectItem>
            <SelectItem value="3">P3</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("workbench.note")}</Label>
        <Textarea
          value={note}
          rows={3}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder={t("workbench.notePlaceholder")}
          className="text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={onSaveNote}
        >
          {t("workbench.noteAdd")}
        </Button>
      </div>

      {rating ? (
        <>
          <Separator />
          <div className="space-y-1">
            <Label className="text-xs">{t("workbench.ratingLabel")}</Label>
            <div className="text-sm">
              {"?".repeat(rating)}
              {"?".repeat(5 - rating)}
            </div>
            {ratingComment ? (
              <p className="text-muted-foreground text-xs">{ratingComment}</p>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
