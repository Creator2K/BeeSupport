import { SignJWT, jwtVerify } from "jose";

import { HttpError } from "./auth";
import { env } from "./env";
import { assertOriginAllowed } from "./widget";

const secret = new TextEncoder().encode(`${env.AUTH_SECRET}:widget-embed`);
type EmbedSite = { id: string; publicKey: string; allowedOrigins: string[] };
export type WidgetOriginContext = {
  origin: string | null;
  preview: boolean;
  embedded: boolean;
};

/** Only an authenticated admin page can mint this short-lived, site-bound preview. */
export async function createPreviewToken(site: EmbedSite): Promise<string> {
  return new SignJWT({ key: site.publicKey })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(site.id)
    .setAudience("beesupport:preview")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** The initial iframe request carries the actual embedding page's Referer. */
export async function createEmbedToken(
  site: EmbedSite,
  referer: string | null,
  previewToken?: string,
): Promise<string> {
  let origin = "";
  try {
    origin = new URL(referer ?? "").origin;
  } catch {
    /* rejected below when restricted */
  }
  let preview = false;
  if (previewToken) {
    try {
      const { payload } = await jwtVerify(previewToken, secret, {
        audience: "beesupport:preview",
        algorithms: ["HS256"],
      });
      preview = payload.sub === site.id && payload.key === site.publicKey;
    } catch {
      /* Expired or forged previews fall back to normal origin checks. */
    }
  }
  if (!preview)
    assertOriginAllowed(site, new Headers(origin ? { origin } : {}));
  return new SignJWT({ origin, key: site.publicKey, preview })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(site.id)
    .setAudience("beesupport:embed")
    .setIssuedAt()
    .setExpirationTime(preview ? "1h" : "24h")
    .sign(secret);
}

/** Same-origin iframe fetches prove their embedding origin with the signed bootstrap token. */
export async function assertWidgetOriginAllowed(
  site: EmbedSite,
  headers: Headers,
): Promise<WidgetOriginContext> {
  const token = headers.get("x-beesupport-embed");
  if (!token) {
    assertOriginAllowed(site, headers);
    return { origin: null, preview: false, embedded: false };
  }
  try {
    const { payload } = await jwtVerify(token, secret, {
      audience: "beesupport:embed",
      algorithms: ["HS256"],
    });
    if (
      payload.sub !== site.id ||
      payload.key !== site.publicKey ||
      typeof payload.origin !== "string"
    ) {
      throw new Error("Invalid embed token");
    }
    if (payload.preview === true)
      return { origin: payload.origin, preview: true, embedded: true };
    assertOriginAllowed(
      site,
      new Headers(payload.origin ? { origin: payload.origin } : {}),
    );
    return {
      origin: payload.origin || null,
      preview: false,
      embedded: Boolean(payload.origin),
    };
  } catch {
    throw new HttpError(403, "嵌入来源已失效，请刷新页面");
  }
}
