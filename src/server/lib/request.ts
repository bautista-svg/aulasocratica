import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "../env";

/** Client IP. Behind Cloudflare + Traefik the real address arrives in forwarding headers. */
export function clientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf.trim();
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
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
