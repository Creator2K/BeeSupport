"use client";

import { Loader2, Paperclip, Send, Sparkles } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPicker } from "@/components/emoji-picker";
import { cn } from "@/lib/utils";

import { AiSuggestionPanel } from "./ai-suggestion-panel";
import { CannedReplyPicker } from "./canned-reply-picker";
import type { AiSuggestionTrace, CannedItem } from "./workbench-types";

type DraftUpdater = (value: string | ((previous: string) => string)) => void;

export function WorkbenchComposer({
  draft,
  draftsReady,
  composerRef,
  sending,
  uploading,
  aiLoading,
  aiReady,
  aiModelOptions,
  activeAiModel,
  aiSuggestion,
  aiTrace,
  newMessagesBelow,
  cannedOpen,
  cannedQuery,
  cannedCategory,
  cannedCategories,
  cannedLoading,
  cannedError,
  cannedItems,
  cannedInserting,
  cannedHasMore,
  onDraftChange,
  onTypingActivity,
  onScrollToLatest,
  onUseSuggestion,
  onDismissSuggestion,
  onModelChange,
  onGenerateSuggestion,
  onCannedOpenChange,
  onCannedQueryChange,
  onCannedCategoryChange,
  onInsertCanned,
  onUploadFile,
  onSend,
  onPaste,
}: {
  draft: string;
  draftsReady: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  sending: boolean;
  uploading: boolean;
  aiLoading: boolean;
  aiReady: boolean;
  aiModelOptions: string[];
  activeAiModel: string;
  aiSuggestion: string | null;
  aiTrace: AiSuggestionTrace | null;
  newMessagesBelow: boolean;
  cannedOpen: boolean;
  cannedQuery: string;
  cannedCategory: string;
  cannedCategories: string[];
  cannedLoading: boolean;
  cannedError: boolean;
  cannedItems: CannedItem[];
  cannedInserting: boolean;
  cannedHasMore: boolean;
  onDraftChange: DraftUpdater;
  onTypingActivity: () => void;
  onScrollToLatest: () => void;
  onUseSuggestion: () => void;
  onDismissSuggestion: () => void;
  onModelChange: (value: string) => void;
  onGenerateSuggestion: () => void;
  onCannedOpenChange: (open: boolean) => void;
  onCannedQueryChange: (value: string) => void;
  onCannedCategoryChange: (value: string) => void;
  onInsertCanned: (item: CannedItem) => Promise<void>;
  onUploadFile: (file: File) => Promise<boolean>;
  onSend: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const t = useT();

  return (
    <div className="bg-card shrink-0 border-t p-3">
      {newMessagesBelow ? (
        <Button
          className="mb-2 w-full"
          variant="secondary"
          size="sm"
          onClick={onScrollToLatest}
        >
          {t("common.newMessages")}
        </Button>
      ) : null}
      {aiSuggestion ? (
        <AiSuggestionPanel
          text={aiSuggestion}
          trace={aiTrace}
          onUse={onUseSuggestion}
          onDismiss={onDismissSuggestion}
        />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          ref={composerRef}
          disabled={!draftsReady}
          maxLength={5000}
          value={draft}
          rows={2}
          placeholder={t("workbench.sendPlaceholder")}
          className="max-h-40 min-h-9 flex-1 resize-none text-sm"
          onChange={(event) => {
            onDraftChange(event.target.value);
            onTypingActivity();
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              onSend();
            }
            if (
              event.key === "/" &&
              !draft &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onCannedQueryChange("");
              onCannedCategoryChange("");
              onCannedOpenChange(true);
            }
          }}
          onPaste={onPaste}
        />

        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          <EmojiPicker
            textareaRef={composerRef}
            value={draft}
            onChange={onDraftChange}
            disabled={sending}
          />
          {aiReady && aiModelOptions.length > 1 ? (
            <Select value={activeAiModel} onValueChange={onModelChange}>
              <SelectTrigger
                size="sm"
                className="h-8 w-[128px] text-[11px]"
                title={t("workbench.aiModel")}
              >
                <SelectValue placeholder={t("workbench.aiModel")} />
              </SelectTrigger>
              <SelectContent align="end" className="max-h-72">
                {aiModelOptions.map((model) => (
                  <SelectItem key={model} value={model} className="text-xs">
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Button
            variant="outline"
            size="icon-sm"
            title={t("workbench.aiSuggest")}
            disabled={aiLoading}
            onClick={onGenerateSuggestion}
          >
            {aiLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
          </Button>

          <CannedReplyPicker
            open={cannedOpen}
            onOpenChange={onCannedOpenChange}
            query={cannedQuery}
            onQueryChange={onCannedQueryChange}
            category={cannedCategory}
            onCategoryChange={onCannedCategoryChange}
            categories={cannedCategories}
            loading={cannedLoading}
            error={cannedError}
            items={cannedItems}
            inserting={cannedInserting}
            hasMore={cannedHasMore}
            onInsert={onInsertCanned}
          />

          <label
            className={cn(
              "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border focus-within:ring-2 focus-within:ring-ring",
              uploading && "pointer-events-none opacity-50",
            )}
            title={t("workbench.attach")}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            <input
              type="file"
              className="sr-only"
              disabled={uploading}
              aria-label={t("workbench.attach")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUploadFile(file);
                event.target.value = "";
              }}
            />
          </label>

          <Button
            size="icon-sm"
            disabled={!draft.trim() || sending}
            onClick={onSend}
            title={t("workbench.send")}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span>{t("workbench.sendPlaceholder")}</span>
        <span className="hidden sm:inline">{t("widget.pasteHint")}</span>
        {draft.length > 4000 ? (
          <span className="text-destructive">{draft.length}/5000</span>
        ) : null}
      </div>
    </div>
  );
}
