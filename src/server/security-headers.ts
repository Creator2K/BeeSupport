/**
 * Response headers applied by the custom server to every Next response.
 * `/widget` is the one page customer sites load in an iframe, so it stays
 * frameable; its allowed embedding origins are enforced by the widget API.
 * Everything else, including the agent and admin consoles, may only be framed
 * by this app itself, which blocks clickjacking.
 *
 * The custom server sets these before Next handles the request, and Next
 * (checked on 15.5) keeps a header that is already set: a route handler that
 * sets one of these names itself is ignored, so change the value here.
 */
export function securityHeaders(
  path: string,
  options: { https: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  if (path !== "/widget" && !path.startsWith("/widget/")) {
    headers["x-frame-options"] = "SAMEORIGIN";
    headers["content-security-policy"] = "frame-ancestors 'self'";
  }
  // Browsers ignore this header over plain HTTP, so it only takes effect on
  // the HTTPS origin and never on a LAN address serving the same app.
  if (options.https)
    headers["strict-transport-security"] = "max-age=15552000";
  return headers;
}
