// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). CF-Connecting-IP is
// only believed when the request really reached our proxy from one of these addresses;
// otherwise anyone hitting the server directly could fake their IP and dodge rate limits.
const CF_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CF_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function v6ToBigInt(ip: string): bigint | null {
  if (!ip.includes(":")) return null;
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    const v = Number.parseInt(g || "0", 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    n = (n << 16n) + BigInt(v);
  }
  return n;
}

export function isCloudflareIp(raw: string): boolean {
  const ip = raw.replace(/^::ffff:/i, "").trim();
  const v4 = v4ToInt(ip);
  if (v4 !== null) {
    return CF_V4.some((cidr) => {
      const [base, bits] = cidr.split("/");
      const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      return ((v4 & mask) >>> 0) === ((v4ToInt(base!)! & mask) >>> 0);
    });
  }
  const v6 = v6ToBigInt(ip.toLowerCase());
  if (v6 === null) return false;
  return CF_V6.some((cidr) => {
    const [base, bits] = cidr.split("/");
    const shift = BigInt(128 - Number(bits));
    return v6 >> shift === v6ToBigInt(base!)! >> shift;
  });
}
