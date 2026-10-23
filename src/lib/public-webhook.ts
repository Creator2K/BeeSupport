import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { HttpError } from "./auth";
import { matchesIp } from "./risk-matching";

export function isPublicWebhookIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 6)
    return (
      matchesIp(ip, "2000::/3") &&
      !["2001::/23", "2001:db8::/32", "2002::/16"].some((range) =>
        matchesIp(ip, range),
      )
    );
  return (
    family === 4 &&
    ![
      "0.0.0.0/8",
      "10.0.0.0/8",
      "100.64.0.0/10",
      "127.0.0.0/8",
      "169.254.0.0/16",
      "172.16.0.0/12",
      "192.0.0.0/24",
      "192.0.2.0/24",
      "192.168.0.0/16",
      "198.18.0.0/15",
      "198.51.100.0/24",
      "203.0.113.0/24",
      "224.0.0.0/4",
      "240.0.0.0/4",
    ].some((range) => matchesIp(ip, range))
  );
}

export async function publicWebhookTarget(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new HttpError(400, "商家通知地址需要使用公网 HTTPS 地址（443 端口）");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
  } catch {
    throw new HttpError(400, "通知地址域名无法解析");
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicWebhookIp(address))
  )
    throw new HttpError(400, "商家通知地址不能指向内网、本机或保留地址");
  return { url, hostname, address: addresses[0]! };
}

/** Pin the validated address for the actual connection; never follow redirects. */
export async function postPublicWebhook(
  value: string,
  body: string,
  headers: Record<string, string>,
): Promise<Response> {
  const target = await publicWebhookTarget(value);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.address.address,
        family: target.address.family,
        servername: isIP(target.hostname) ? undefined : target.hostname,
        port: 443,
        method: "POST",
        path: target.url.pathname + target.url.search,
        headers: {
          ...headers,
          host: target.url.host,
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16384) res.destroy(new Error("通知响应超过 16 KiB"));
          else chunks.push(chunk);
        });
        res.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        res.on("end", () => {
          clearTimeout(timer);
          const status = res.statusCode ?? 502;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status },
            ),
          );
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("通知请求超时")),
      10000,
    );
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(body);
  });
}
