import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { db, schema } from "@server/db/client";
import { setGoogleFetch } from "@server/auth/google";
import { runRetention } from "@server/services/retention";

const CLIENT_ID = "test-client.apps.googleusercontent.com"; // vitest.config.ts

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims: Record<string, unknown>) {
  return `${b64({ alg: "RS256", kid: "x" })}.${b64(claims)}.firma`;
}

/** Google's side: answers the code exchange with these claims (plus the flow's nonce). */
function google(claims: Record<string, unknown>, opts: { status?: number } = {}) {
  const seen: URLSearchParams[] = [];
  setGoogleFetch(async (_url, init) => {
    const body = new URLSearchParams(String(init.body));
    seen.push(body);
    return new Response(JSON.stringify({ id_token: idToken({ ...claims, nonce: claims.nonce ?? flowNonce }) }), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return seen;
}

let flowNonce = "";
async function start(cookie?: string, next = "/app") {
  const r = await call("GET", `/api/auth/google/start?next=${encodeURIComponent(next)}`, { cookie });
  expect(r.status).toBe(302);
  const url = new URL(r.headers.get("location")!);
  flowNonce = url.searchParams.get("nonce")!;
  return { url, flow: cookiePair(r.cookies, "as_g") };
}

const claimsFor = (email: string, sub = `sub-${email}`) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub,
  email,
  email_verified: true,
  name: "Vanina Gerstner",
});

async function callback(flow: string, state: string, device?: string, extra = "") {
  const cookie = [flow, device].filter(Boolean).join("; ");
  return call("GET", `/api/auth/google/callback?code=codigo-123&state=${encodeURIComponent(state)}${extra}`, { cookie });
}

afterEach(() => setGoogleFetch(null));

describe("Continuar con Google", () => {
  it("is offered when configured and sends the teacher to Google with PKCE, state and nonce", async () => {
    expect((await call("GET", "/api/auth/providers")).body).toEqual({ google: true });
    const { url, flow } = await start(undefined, "/app/cuenta");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/google/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(flow).toMatch(/^as_g=/);
  });

  it("creates an account for a new teacher and lands where she was going", async () => {
    const seen = google(claimsFor("nueva@escuela.edu.ar"));
    const { url, flow } = await start(undefined, "/app/cuenta");
    const r = await callback(flow, url.searchParams.get("state")!);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app/cuenta");
    // The code exchange carries the secret and the PKCE verifier.
    expect(seen[0]!.get("client_secret")).toBe("test-google-secret");
    expect(seen[0]!.get("code_verifier")).toMatch(/^[\w-]{40,}$/);
    expect(seen[0]!.get("redirect_uri")).toBe("http://localhost:5173/api/auth/google/callback");
    const me = await call("GET", "/api/auth/me", { cookie: cookiePair(r.cookies, "as_t") });
    expect(me.body.teacher).toMatchObject({ email: "nueva@escuela.edu.ar", hasAccount: true, google: true, hasPassword: false, displayName: "Vanina Gerstner" });
  });

  it("signs in to an existing password account with the same email, keeping it and what was done on this device", async () => {
    // Her account, with a classroom.
    const mine = await newTeacher();
    await call("POST", "/api/auth/register", { cookie: mine.cookie, body: { email: "vgerstner@northfield.edu.ar", password: "una-clave-larga" } });
    const room = await newClassroom(mine.cookie, "3.º A");
    // Another device, anonymous, with a classroom of its own.
    const device = await newTeacher();
    const deviceRoom = await newClassroom(device.cookie, "3.º B");

    google(claimsFor("VGerstner@Northfield.edu.ar", "sub-vanina"));
    const { url, flow } = await start(device.cookie);
    const r = await callback(flow, url.searchParams.get("state")!, device.cookie);
    expect(r.headers.get("location")).toBe("/app");
    const cookie = cookiePair(r.cookies, "as_t");
    const me = await call("GET", "/api/auth/me", { cookie });
    expect(me.body.teacher).toMatchObject({ id: mine.id, email: "vgerstner@northfield.edu.ar", google: true, hasPassword: true });
    const rooms = (await call("GET", "/api/classrooms", { cookie })).body.classrooms.map((c: { id: string }) => c.id);
    expect(rooms).toEqual(expect.arrayContaining([room, deviceRoom]));
    // The password still works.
    expect((await call("POST", "/api/auth/login", { body: { email: "vgerstner@northfield.edu.ar", password: "una-clave-larga" } })).status).toBe(200);

    // Next time Google finds her by her Google id, even from a fresh device.
    google(claimsFor("vgerstner@northfield.edu.ar", "sub-vanina"));
    const again = await start();
    const r2 = await callback(again.flow, again.url.searchParams.get("state")!);
    expect(r2.headers.get("location")).toBe("/app");
    expect((await call("GET", "/api/auth/me", { cookie: cookiePair(r2.cookies, "as_t") })).body.teacher.id).toBe(mine.id);
  });

  it("turns the workspace open on this device into the account when the email is new", async () => {
    const device = await newTeacher();
    const room = await newClassroom(device.cookie, "4.º A");
    google(claimsFor("otra@escuela.edu.ar"));
    const { url, flow } = await start(device.cookie);
    const r = await callback(flow, url.searchParams.get("state")!, device.cookie);
    expect(r.headers.get("location")).toBe("/app");
    const me = await call("GET", "/api/auth/me", { cookie: device.cookie });
    expect(me.body.teacher).toMatchObject({ id: device.id, email: "otra@escuela.edu.ar", hasAccount: true, google: true });
    expect((await call("GET", "/api/classrooms", { cookie: device.cookie })).body.classrooms.map((c: { id: string }) => c.id)).toEqual([room]);
  });

  it("refuses a missing or foreign state, a cancelled consent, a token for someone else and an unverified email", async () => {
    google(claimsFor("x@escuela.edu.ar"));
    const a = await start();
    const forged = await callback(a.flow, "otro-state");
    expect(forged.headers.get("location")).toBe("/ingresar?google=vencido");
    expect(forged.cookies.find((c) => c.startsWith("as_t="))).toBeUndefined();

    const b = await start();
    const noCookie = await call("GET", `/api/auth/google/callback?code=c&state=${b.url.searchParams.get("state")}`);
    expect(noCookie.headers.get("location")).toBe("/ingresar?google=vencido");

    const c = await start();
    const denied = await call("GET", `/api/auth/google/callback?error=access_denied&state=${c.url.searchParams.get("state")}`, { cookie: c.flow });
    expect(denied.headers.get("location")).toBe("/ingresar?google=cancelado");

    google({ ...claimsFor("x@escuela.edu.ar"), aud: "otra-app.apps.googleusercontent.com" });
    const d = await start();
    expect((await callback(d.flow, d.url.searchParams.get("state")!)).headers.get("location")).toBe("/ingresar?google=error");

    google({ ...claimsFor("x@escuela.edu.ar"), nonce: "otro-nonce" });
    const e = await start();
    expect((await callback(e.flow, e.url.searchParams.get("state")!)).headers.get("location")).toBe("/ingresar?google=error");

    google({ ...claimsFor("x@escuela.edu.ar"), email_verified: false });
    const f = await start();
    expect((await callback(f.flow, f.url.searchParams.get("state")!)).headers.get("location")).toBe("/ingresar?google=sin-verificar");

    google(claimsFor("x@escuela.edu.ar"), { status: 400 });
    const g = await start();
    expect((await callback(g.flow, g.url.searchParams.get("state")!)).headers.get("location")).toBe("/ingresar?google=error");

    expect(await db.select().from(schema.teachers)).toHaveLength(0);
  });

  it("does not take over an email that another Google account already uses", async () => {
    google(claimsFor("compartido@escuela.edu.ar", "sub-uno"));
    const a = await start();
    await callback(a.flow, a.url.searchParams.get("state")!);
    google(claimsFor("compartido@escuela.edu.ar", "sub-dos"));
    const b = await start();
    expect((await callback(b.flow, b.url.searchParams.get("state")!)).headers.get("location")).toBe("/ingresar?google=otra-cuenta");
  });

  it("only goes back to pages inside the app", async () => {
    for (const next of ["https://otro.sitio/app", "//otro.sitio/app", "/api/admin/requests"]) {
      google(claimsFor(`n${next.length}@escuela.edu.ar`));
      const { url, flow } = await start(undefined, next);
      expect((await callback(flow, url.searchParams.get("state")!)).headers.get("location")).toBe("/app");
    }
  });

  it("an account that only uses Google is never removed by the retention job", async () => {
    google(claimsFor("solo.google@escuela.edu.ar"));
    const { url, flow } = await start();
    await callback(flow, url.searchParams.get("state")!);
    await db.update(schema.teachers).set({ lastSeenAt: new Date(Date.now() - 400 * 86_400_000) });
    await runRetention();
    const [row] = await db.select().from(schema.teachers).where(eq(schema.teachers.email, "solo.google@escuela.edu.ar"));
    expect(row).toBeTruthy();
  });
});
