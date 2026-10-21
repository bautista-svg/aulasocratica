import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "../env";
import { isCloudflareIp } from "./cloudflare-ip";

/**
 * Client IP. Behind Traefik, the LAST X-Forwarded-For entry is the address that connected to
 * Traefik (not client-controlled). If that address is Cloudflare, the real client is in
 * CF-Connecting-IP; otherwise it is that address itself.
 */
export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for");
    const peer = xff?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
    if (peer) {
      const cf = c.req.header("cf-connecting-ip")?.trim();
      return cf && isCloudflareIp(peer) ? cf : peer;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function userAgent(c: Context): string {
  return (c.req.header("user-agent") ?? "").slice(0, 200);
}
