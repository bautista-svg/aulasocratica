import type { MiddlewareHandler } from "hono";
import { env, isProd, secureCookies } from "../env";
import { forbidden } from "./errors";

const allowedOrigin = new URL(env.PUBLIC_URL).origin;

/**
 * CSRF protection for cookie-authenticated mutations: browsers always send Origin on
 * cross-site POST/PUT/PATCH/DELETE, so anything not from our own origin is rejected.
 * Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export const sameOriginMutations: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    const devOk = !isProd && origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin && origin !== allowedOrigin && !devOk) throw forbidden("Solicitud bloqueada por seguridad (origen no permitido).");
    if (!origin) {
      // Same-origin fetches from modern browsers include Origin on POST; requests without it
      // must at least carry our custom header, which cross-site forms cannot set.
      if (c.req.header("x-aula-client") !== "1") throw forbidden("Solicitud bloqueada por seguridad.");
    }
  }
  await next();
};

/** Content-Security-Policy and other headers for every response. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(self), payment=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  if (isProd && secureCookies) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const ct = h.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    h.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Cloudflare Web Analytics is injected by the zone (becode.com.ar); disclosed in /privacidad.
        "script-src 'self' https://static.cloudflareinsights.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://cloudflareinsights.com",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(secureCookies ? ["upgrade-insecure-requests"] : []),
      ].join("; "),
    );
  }
};
