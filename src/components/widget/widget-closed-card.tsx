"use client";

import { ArrowLeft, Star } from "lucide-react";

import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type WidgetClosedCardProps = {
  ratingEnabled: boolean;
  ratingSubmitted: boolean;
  existingRating: number | null | undefined;
  ratingValue: number;
  ratingComment: string;
  onRatingValueChange: (value: number) => void;
  onRatingCommentChange: (value: string) => void;
  onSubmitRating: () => void;
  onStartNew: () => void;
};

export function WidgetClosedCard({
  ratingEnabled,
  ratingSubmitted,
  existingRating,
  ratingValue,
  ratingComment,
  onRatingValueChange,
  onRatingCommentChange,
  onSubmitRating,
  onStartNew,
}: WidgetClosedCardProps) {
  const t = useT();

  return (
    <div className="bg-card space-y-3 rounded-xl border px-3.5 py-3.5 shadow-xs">
      <p className="text-sm font-medium">{t("widget.closedByAgent")}</p>
      {!ratingEnabled ? null : ratingSubmitted || existingRating ? (
        <p className="text-muted-foreground text-xs">
          {t("widget.rateThanks")}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{t("widget.rateHint")}</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value}`}
                onClick={() => onRatingValueChange(value)}
              >
                <Star
                  className={cn(
                    "size-5",
                    value <= ratingValue
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground",
                  )}
                />
              </button>
            ))}
          </div>
          <Textarea
            value={ratingComment}
            rows={2}
            className="text-xs"
            placeholder={t("widget.rateComment")}
            onChange={(event) => onRatingCommentChange(event.target.value)}
          />
          <Button
            size="sm"
            disabled={ratingValue === 0}
            onClick={onSubmitRating}
          >
            {t("widget.rateSubmit")}
          </Button>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onStartNew}>
        <ArrowLeft className="size-3.5" />
        <span className="ml-1.5">{t("widget.startNew")}</span>
      </Button>
    </div>
  );
}
