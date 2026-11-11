import type { AiJob } from "@prisma/client";
import { claimAiJob, expireAiJobs, finishAiJob, renewAiJob } from "./services/ai-job-queue";
import { processAutoReply } from "./services/ai-auto-reply";
import { processKnowledgeIndex } from "./services/knowledge";

export async function runAiJob(job: AiJob): Promise<void> {
  const heartbeat = setInterval(() => {
    void renewAiJob(job).catch((error: unknown) => console.error("[ai-jobs] Lease renewal failed:", error));
  }, 30_000);
  heartbeat.unref();
  try {
    const result = job.kind === "AUTO_REPLY"
      ? await processAutoReply(job)
      : job.kind === "KNOWLEDGE_INDEX"
        ? await processKnowledgeIndex(job)
        : (() => { throw new Error("Unknown AI task kind"); })();
    await finishAiJob(job, result);
  } catch (error) {
    await finishAiJob(job, error instanceof Error ? error : new Error(String(error)));
  } finally {
    clearInterval(heartbeat);
  }
}

/** Fixed concurrency per instance; database leases coordinate separate processes. */
export function startAiWorker(): () => Promise<void> {
  let stopping = false;
  const active = new Set<Promise<void>>();
  let polling: Promise<void> | null = null;
  const poll = async () => {
    try {
      await expireAiJobs();
      while (!stopping && active.size < 2) {
        const job = await claimAiJob();
        if (!job) break;
        const work = runAiJob(job)
          .catch((error: unknown) => console.error("[ai-jobs] Task failed:", error))
          .finally(() => active.delete(work));
        active.add(work);
      }
    } catch (error) {
      console.error("[ai-jobs] Poll failed:", error);
    }
  };
  const tick = () => {
    if (stopping || polling) return;
    polling = poll().finally(() => { polling = null; });
  };
  tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await polling;
    // A process killed before completion leaves its lease for the next worker to recover.
    await Promise.allSettled([...active]);
  };
}
