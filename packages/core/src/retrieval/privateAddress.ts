import net from "node:net";

/** True for loopback, RFC1918 private, link-local, and unique-local IPv6. */
export function isPrivateOrLocalIp(ip: string): boolean {
  const normalised = stripIpv4MappedPrefix(ip.trim().toLowerCase());

  if (net.isIP(normalised) === 0) return false;

  if (net.isIP(normalised) === 4) {
    return isPrivateIpv4(normalised);
  }

  return isPrivateIpv6(normalised);
}

function stripIpv4MappedPrefix(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    const rest = ip.slice("::ffff:".length);
    if (net.isIP(rest) === 4) return rest;
  }
  return ip;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  // Unique local fc00::/7
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  // Link-local fe80::/10
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true;
  }
  return false;
}
