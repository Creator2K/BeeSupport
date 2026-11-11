/**
 * Waits until streamed content has been revealed and entrance animations have
 * finished, so checks such as axe see the page as people do.
 *
 * React reveals streamed Suspense content in batches after the load event, and
 * each section fades in when it appears; axe measures contrast through that
 * partial opacity. The page counts as settled after QUIET_MS without a hidden
 * streamed segment or a running finite animation.
 */
export async function waitForSettledPage(page, { timeout = 10_000 } = {}) {
  await page.evaluate(async (limit) => {
    const QUIET_MS = 400;
    const busy = () =>
      document.querySelector("div[hidden][id^='S:']") !== null ||
      document
        .getAnimations()
        .some(
          (a) =>
            a.playState === "running" &&
            Number.isFinite(a.effect?.getTiming().iterations),
        );
    const deadline = performance.now() + limit;
    let quietSince = null;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (busy()) quietSince = null;
      else quietSince ??= performance.now();
      if (quietSince !== null && performance.now() - quietSince >= QUIET_MS) return;
    }
  }, timeout);
}
