// "Continuar con Google": OpenID Connect authorization code flow with PKCE. The state, the PKCE
// verifier and the nonce travel in a short-lived httpOnly cookie (__Host- in production, so a
// sibling subdomain cannot plant one); the ID token comes straight from Google's token endpoint
// over TLS, and only a verified email is accepted.
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { env, secureCookies } from "../env";
import { randomToken, safeEqual } from "../lib/crypto";

export const googleEnabled = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_COOKIE = secureCookies ? "__Host-as_g" : "as_g";
const FLOW_MINUTES = 10;

export const redirectUri = () => `${new URL(env.PUBLIC_URL).origin}/api/auth/google/callback`;

/** Where to go after signing in: only paths inside the app (never another site). */
export function safeNext(next: string | undefined): string {
  return next && /^\/(app|ingresar)(\/|$|\?)/.test(next) && !next.startsWith("//") ? next : "/app";
}

interface Flow {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  exp: number;
}

/** Starts the flow: remembers it in the cookie and returns Google's consent URL. */
export function startFlow(c: Context, next: string): string {
  const flow: Flow = { state: randomToken(24), verifier: randomToken(48), nonce: randomToken(24), next: safeNext(next), exp: Date.now() + FLOW_MINUTES * 60_000 };
  setCookie(c, FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
    httpOnly: true,
    secure: secureCookies,
    // Lax: the cookie must come back on Google's top-level redirect to the callback.
    sameSite: "Lax",
    path: "/",
    maxAge: FLOW_MINUTES * 60,
  });
  const challenge = createHash("sha256").update(flow.verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** The flow this browser started (read once: the cookie is cleared), or null if missing/expired/forged. */
export function takeFlow(c: Context, state: string | undefined): Flow | null {
  const raw = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: "/", secure: secureCookies });
  if (!raw || !state) return null;
  try {
    const flow = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Flow;
    if (typeof flow.state !== "string" || !safeEqual(flow.state, state) || flow.exp < Date.now()) return null;
    return flow;
  } catch {
    return null;
  }
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

type TokenFetch = (url: string, init: RequestInit) => Promise<Response>;
let tokenFetch: TokenFetch = (url, init) => fetch(url, init);
/** Tests replace Google's token endpoint. */
export function setGoogleFetch(fn: TokenFetch | null) {
  tokenFetch = fn ?? ((url, init) => fetch(url, init));
}

export class GoogleError extends Error {
  constructor(readonly reason: "error" | "unverified") {
    super(reason);
  }
}

function claims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new GoogleError("error");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Exchanges the code for the ID token and checks it was issued for us, now, for this flow. */
export async function profileFromCode(code: string, flow: Flow): Promise<GoogleProfile> {
  const res = await tokenFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleError("error");
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new GoogleError("error");
  const c = claims(body.id_token);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  const valid =
    ISSUERS.includes(String(c.iss)) &&
    aud.includes(env.GOOGLE_CLIENT_ID) &&
    typeof c.exp === "number" &&
    c.exp * 1000 > Date.now() - 60_000 &&
    c.nonce === flow.nonce &&
    typeof c.sub === "string" &&
    c.sub.length > 0 &&
    typeof c.email === "string";
  if (!valid) throw new GoogleError("error");
  if (c.email_verified !== true && c.email_verified !== "true") throw new GoogleError("unverified");
  return {
    sub: c.sub as string,
    email: (c.email as string).trim().toLowerCase(),
    name: typeof c.name === "string" ? c.name.trim().slice(0, 80) : "",
  };
}
