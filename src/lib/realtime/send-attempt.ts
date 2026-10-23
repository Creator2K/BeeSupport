export type SendAttempt = { scope: string; body: string; clientId: string };

/** Keep the same idempotency key when a lost acknowledgement makes delivery uncertain. */
export function prepareSendAttempt(
  previous: SendAttempt | null,
  scope: string,
  body: string,
): SendAttempt {
  if (previous?.scope === scope && previous.body === body) return previous;
  return {
    scope,
    body,
    clientId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
  };
}
