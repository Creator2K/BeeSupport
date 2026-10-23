"use client";
import { useEffect, useState } from "react";
import { Clock, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
export function DueFollowUps() {
  const [due, setDue] = useState<number | null>(null);
  const [unanswered, setUnanswered] = useState<number | null>(null);
  useEffect(() => {
    let active = true,
      running = false;
    const controller = new AbortController();
    async function refresh() {
      if (document.hidden || running) return;
      running = true;
      try {
        const response = await fetch("/api/agent/follow-ups/count", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (active) {
            setDue(data.due);
            setUnanswered(data.unanswered);
          }
        }
      } catch {
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("beesupport:followups-changed", refresh);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beesupport:followups-changed", refresh);
    };
  }, []);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="gap-1 px-1.5">
        <a
          href="/agent/follow-ups"
          aria-label={`我的跟进${due === null ? "" : `，已到期 ${due} 项`}`}
          title="我的跟进待办"
        >
          <Clock className="size-4" />
          {due !== null && due > 0 && (
            <span className="rounded bg-red-100 px-1 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
              {due > 99 ? "99+" : due}
            </span>
          )}
        </a>
      </Button>
      <Button asChild variant="ghost" size="sm" className="gap-1 px-1.5">
        <a
          href="/agent/unanswered"
          aria-label={`未回复提醒${unanswered === null ? "" : `，待处理 ${unanswered} 项`}`}
          title="长时间未回复提醒"
        >
          <Bell className="size-4" />
          {unanswered !== null && unanswered > 0 && (
            <span className="rounded bg-red-100 px-1 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-300">
              {unanswered > 99 ? "99+" : unanswered}
            </span>
          )}
        </a>
      </Button>
    </>
  );
}
