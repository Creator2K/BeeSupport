import type { SerializedMessage } from "./types";

/** Updating an older message must not move the cursor past unloaded history. */
export function applyMessageDeletion(current: SerializedMessage[], deleted: SerializedMessage) {
  return current.map((message) => message.id === deleted.id ? deleted : message);
}

/** Merge snapshots with live arrivals, replacing optimistic retries by their clientId. */
export function mergeMessages(
  current: SerializedMessage[],
  incoming: SerializedMessage[],
): SerializedMessage[] {
  const confirmed = new Set(
    incoming
      .filter((message) => !message.id.startsWith("tmp-"))
      .map((message) => message.clientId)
      .filter(Boolean),
  );
  const merged = new Map(
    current
      .filter(
        (message) =>
          !message.id.startsWith("tmp-") || !confirmed.has(message.clientId),
      )
      .map((message) => [message.id, message]),
  );
  for (const message of incoming) {
    // A snapshot started before deletion can arrive after the live update.
    if (!merged.get(message.id)?.deletedAt || message.deletedAt)
      merged.set(message.id, message);
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function restartsHistory(
  current: SerializedMessage[],
  incoming: SerializedMessage[],
): boolean {
  const existing = current.filter((message) => !message.id.startsWith("tmp-"));
  const ids = new Set(incoming.map((message) => message.id));
  return Boolean(
    incoming.length >= 200 &&
    existing.length &&
    !existing.some((message) => ids.has(message.id)) &&
    incoming.at(-1)!.createdAt >= existing.at(-1)!.createdAt,
  );
}

/** Polling a full latest page must not forget that older history was already exhausted. */
export function snapshotHasOlderMessages(
  current: SerializedMessage[],
  incoming: SerializedMessage[],
  knownHasOlder?: boolean,
): boolean {
  if (
    !current.some((message) => !message.id.startsWith("tmp-")) ||
    restartsHistory(current, incoming)
  )
    return incoming.length >= 200;
  return knownHasOlder ?? incoming.length >= 200;
}

/** A long disconnect may leave a gap before the bounded latest window. Restart history at that window. */
export function mergeMessageSnapshot(
  current: SerializedMessage[],
  incoming: SerializedMessage[],
): SerializedMessage[] {
  if (restartsHistory(current, incoming)) {
    return mergeMessages(
      current.filter((message) => message.id.startsWith("tmp-")),
      incoming,
    );
  }
  return mergeMessages(current, incoming);
}
