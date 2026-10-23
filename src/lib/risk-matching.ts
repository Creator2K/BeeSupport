import { BlockList, isIP } from "node:net";

export function normalizeIp(value: string): string {
  const ip = value.trim().toLowerCase();
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function parseIpRule(value: string): {
  address: string;
  prefix?: number;
  family: "ipv4" | "ipv6";
  value: string;
} {
  const [raw = "", prefix, ...extra] = value.trim().split("/");
  const address = normalizeIp(raw);
  const version = isIP(address);
  if (
    !version ||
    extra.length ||
    (prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))
  )
    throw new Error("请输入有效 IPv4、IPv6 或 CIDR 网段");
  return {
    address,
    prefix: prefix === undefined ? undefined : Number(prefix),
    family: version === 4 ? "ipv4" : "ipv6",
    value: `${address}${prefix === undefined ? "" : `/${Number(prefix)}`}`,
  };
}

export function matchesIp(ip: string, rule: string): boolean {
  try {
    const parsed = parseIpRule(rule);
    const target = normalizeIp(ip);
    if (!isIP(target)) return false;
    const list = new BlockList();
    if (parsed.prefix === undefined)
      list.addAddress(parsed.address, parsed.family);
    else list.addSubnet(parsed.address, parsed.prefix, parsed.family);
    return list.check(target, isIP(target) === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

/** Literal phrases only; normalize case, full-width forms and invisible/spacing evasion. */
export function normalizeRiskText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "");
}

export function matchesWord(text: string, word: string): boolean {
  const normalized = normalizeRiskText(word);
  return Boolean(normalized) && normalizeRiskText(text).includes(normalized);
}
