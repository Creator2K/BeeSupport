import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

export const CLIENT_IP_HEADER = "x-beesupport-client-ip";

function normalizeIp(value: string): string {
  const ip = value.trim();
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

/** Trust only explicitly configured proxy addresses, never a client-supplied header. */
export function createClientIpResolver(cidrs = "") {
  const trusted = new BlockList();
  for (const entry of cidrs
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [rawAddress, prefix, ...extra] = entry.split("/");
    const address = normalizeIp(rawAddress!);
    const version = isIP(address);
    if (
      !version ||
      extra.length ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))
    ) {
      throw new Error(`TRUSTED_PROXY_CIDRS 包含无效地址：${entry}`);
    }
    const family = version === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) trusted.addAddress(address, family);
    else trusted.addSubnet(address, Number(prefix), family);
  }
  const isTrusted = (ip: string) =>
    trusted.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  return (
    remoteAddress: string | undefined,
    forwarded: string | undefined,
  ): string => {
    const peer = normalizeIp(remoteAddress ?? "");
    if (!isIP(peer)) return "0.0.0.0";
    if (!isTrusted(peer) || !forwarded || forwarded.length > 4096) return peer;
    const chain = forwarded.split(",").map(normalizeIp);
    if (chain.length > 32 || chain.some((ip) => !isIP(ip))) return peer;
    let current = peer;
    for (
      let index = chain.length - 1;
      index >= 0 && isTrusted(current);
      index -= 1
    ) {
      current = chain[index]!;
    }
    return current;
  };
}

export function setClientIp(
  req: IncomingMessage,
  resolve: ReturnType<typeof createClientIpResolver>,
): void {
  const forwarded = req.headers["x-forwarded-for"];
  // Always overwrite the internal header, including requests that try to forge it.
  req.headers[CLIENT_IP_HEADER] = resolve(
    req.socket.remoteAddress,
    typeof forwarded === "string" ? forwarded : undefined,
  );
}
