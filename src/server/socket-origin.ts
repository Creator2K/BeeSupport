function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Normalise a comma-separated list of URLs or origins; entries that are not http(s) are dropped. */
export function parseSocketOrigins(
  ...values: Array<string | undefined>
): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(",")) {
      const url = entry.trim() ? parseOrigin(entry) : null;
      if (url) origins.add(url.origin);
    }
  }
  return [...origins];
}

/**
 * Agent sockets authenticate with the session cookie, so a page on another
 * origin must not be able to open one. Every legitimate client (workbench and
 * the widget iframe) is served by this app, so its Origin either matches a
 * configured origin or the Host the request was sent to. Requests without an
 * Origin header are not cross-origin browser requests and stay allowed.
 */
export function isSocketOriginAllowed(input: {
  origin: string | undefined;
  host: string | undefined;
  allowedOrigins: readonly string[];
}): boolean {
  if (!input.origin) return true;
  const url = parseOrigin(input.origin);
  if (!url) return false;
  if (input.allowedOrigins.includes(url.origin)) return true;
  const host = input.host?.trim().toLowerCase();
  if (!host) return false;
  const defaultPort = url.protocol === "https:" ? ":443" : ":80";
  return (
    url.host === (host.endsWith(defaultPort) ? host.slice(0, -defaultPort.length) : host)
  );
}
