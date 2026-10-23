const ROOT = "beesupport:drafts:v1:";
const TTL = 7 * 86400000;
const MAX = 50;
export function draftPrefix(userId: string) {
  return `${ROOT}${encodeURIComponent(userId)}:`;
}
export function draftLogoutKey(userId: string) {
  return `beesupport:drafts:logout:${encodeURIComponent(userId)}`;
}
function entries(storage: Storage, userId: string, now: number) {
  const prefix = draftPrefix(userId),
    rows: { key: string; id: string; text: string; at: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null");
      if (
        typeof value?.text === "string" &&
        value.text.length <= 5000 &&
        Number.isFinite(value.at) &&
        value.at <= now &&
        value.at > now - TTL
      )
        rows.push({
          key,
          id: decodeURIComponent(key.slice(prefix.length)),
          text: value.text,
          at: value.at,
        });
    } catch {
      /* Ignore corrupt local entries. */
    }
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, MAX);
}
export function loadDrafts(
  storage: Storage,
  userId: string,
  now = Date.now(),
): Record<string, string> {
  try {
    return Object.fromEntries(
      entries(storage, userId, now).map((row) => [row.id, row.text]),
    );
  } catch {
    return {};
  }
}
export function storeDraft(
  storage: Storage,
  userId: string,
  id: string,
  text: string,
  now = Date.now(),
) {
  try {
    const key = draftPrefix(userId) + encodeURIComponent(id);
    if (!text) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify({ text: text.slice(0, 5000), at: now }),
    );
    const keep = new Set(entries(storage, userId, now).map((row) => row.key)),
      remove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(draftPrefix(userId)) && !keep.has(k)) remove.push(k);
    }
    remove.forEach((k) => storage.removeItem(k));
  } catch {
    /* A blocked/full local store must never prevent chatting. */
  }
}
export function clearAccountDrafts(userId: string) {
  try {
    localStorage.setItem(draftLogoutKey(userId), String(Date.now()));
  } catch {}
  try {
    const prefix = draftPrefix(userId),
      keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* Storage may be disabled by the browser. */
  }
  window.dispatchEvent(
    new CustomEvent("beesupport:drafts-cleared", { detail: userId }),
  );
}
