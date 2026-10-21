// CSRF (Origin / custom header), CORS, security headers, static file traversal, error bodies.
import { Actor, BASE, setupTeacher, check, done } from "./lib.mjs";

const A = await setupTeacher("Docente CSRF");
const cookie = A.t.cookieHeader();
const raw = (method, path, headers = {}, body) =>
  fetch(BASE + path, { method, headers: { cookie, ...headers }, body, redirect: "manual" });

// 1. Cross-site JSON mutation with a foreign Origin.
let r = await raw("PATCH", "/api/auth/me", { origin: "https://evil.example", "content-type": "application/json" }, JSON.stringify({ displayName: "pwned" }));
check("PATCH con Origin ajeno → 403", r.status === 403, String(r.status));
// 2. Without Origin and without x-aula-client.
r = await raw("PATCH", "/api/auth/me", { "content-type": "application/json" }, JSON.stringify({ displayName: "pwned" }));
check("PATCH sin Origin ni x-aula-client → 403", r.status === 403, String(r.status));
// 3. Origin: null (sandboxed iframe / data: URL).
r = await raw("POST", "/api/auth/logout", { origin: "null" });
check("POST con Origin: null → 403", r.status === 403, String(r.status));
// 4. Cross-site HTML form (urlencoded / text/plain / multipart) to every kind of endpoint.
r = await raw("POST", "/api/auth/start", { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, "");
check("form cross-site a /api/auth/start → 403", r.status === 403, String(r.status));
r = await raw("POST", `/api/activities/${A.activityId}/link/regenerate`, { origin: "https://evil.example", "content-type": "text/plain" }, "{}");
check("form text/plain cross-site a regenerate → 403", r.status === 403, String(r.status));
r = await raw("DELETE", "/api/auth/workspace", { origin: "https://evil.example", "content-type": "application/json" }, JSON.stringify({ confirm: "BORRAR" }));
check("DELETE workspace cross-site → 403", r.status === 403, String(r.status));
// 5. Same-origin no-JS form (as the prerendered landing does).
const fresh = await fetch(BASE + "/api/auth/start", { method: "POST", headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: "", redirect: "manual" });
check("form propio a /api/auth/start → 303 /app con cookie", fresh.status === 303 && fresh.headers.get("location") === "/app" && (fresh.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("as_t=")), `${fresh.status} ${fresh.headers.get("location")}`);
console.log("Set-Cookie docente:", (fresh.headers.getSetCookie?.() ?? []).join(" | ").replace(/as_t=[^;]+/, "as_t=<token>"));
// 6. GET is never a mutation (no state change on GET).
r = await raw("GET", `/api/activities/${A.activityId}/link/regenerate`);
check("GET a una ruta de mutación no muta (404 de ruta)", r.status === 404, String(r.status));

// 7. CORS: no Access-Control-Allow-* for foreign origins (preflight and simple GET).
r = await raw("OPTIONS", "/api/auth/me", { origin: "https://evil.example", "access-control-request-method": "PATCH", "access-control-request-headers": "content-type,x-aula-client" });
check("preflight desde origen ajeno sin Access-Control-Allow-Origin", !r.headers.get("access-control-allow-origin"), `${r.status} acao=${r.headers.get("access-control-allow-origin")}`);
r = await raw("GET", "/api/auth/me", { origin: "https://evil.example" });
check("GET con Origin ajeno sin ACAO / ACAC", !r.headers.get("access-control-allow-origin") && !r.headers.get("access-control-allow-credentials"));

// 8. Security headers on HTML, API, files.
const html = await fetch(BASE + "/app/aulas");
const h = Object.fromEntries(html.headers);
console.log("Headers de HTML (/app/aulas):", JSON.stringify({ csp: h["content-security-policy"], xfo: h["x-frame-options"], xcto: h["x-content-type-options"], rp: h["referrer-policy"], pp: h["permissions-policy"], coop: h["cross-origin-opener-policy"], corp: h["cross-origin-resource-policy"], hsts: h["strict-transport-security"] ?? "(no: PUBLIC_URL http en esta instancia)" }));
check("CSP con script-src 'self' y frame-ancestors 'none'", /script-src 'self'/.test(h["content-security-policy"] ?? "") && /frame-ancestors 'none'/.test(h["content-security-policy"] ?? ""));
check("X-Frame-Options DENY", h["x-frame-options"] === "DENY");
const landing = await fetch(BASE + "/");
check("landing también con CSP", Boolean(landing.headers.get("content-security-policy")));
const body = await landing.text();
check("landing sin <script> inline", !/<script(?![^>]*\bsrc=)[^>]*>/i.test(body));

// 9. Static traversal attempts.
for (const p of ["/..%2f..%2fpackage.json", "/assets/..%2f..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/.env", "/assets/%2e%2e%2f%2e%2e%2fserver%2findex.mjs", "/..\\..\\package.json", "/index.mjs.map", "/../server/index.mjs"]) {
  const res = await fetch(BASE + p);
  const t = await res.text();
  const leaked = /"dependencies"|DATABASE_URL|createApp|sourceMappingURL/.test(t);
  check(`estático ${p} no filtra archivos fuera de dist/client`, !leaked, `${res.status} ${res.headers.get("content-type")}`);
}

// 10. Error bodies do not include stacks / internals.
const bad = await raw("POST", "/api/classrooms", { origin: BASE, "content-type": "application/json" }, "{not json");
console.log("JSON inválido →", bad.status, await bad.text());
const big = await raw("POST", "/api/classrooms", { origin: BASE, "content-type": "application/json" }, JSON.stringify({ name: "x".repeat(2 * 1024 * 1024) }));
console.log("JSON de 2 MB →", big.status, await big.text());
// (after a 413 the server closes the socket; give undici a new connection)
await new Promise((res) => setTimeout(res, 300));
const uuidish = await raw("GET", "/api/sessions/" + encodeURIComponent("' or 1=1--"), { connection: "close" }).catch(() => raw("GET", "/api/sessions/" + encodeURIComponent("' or 1=1--")));
console.log("id no uuid →", uuidish.status, await uuidish.text());
const health = await fetch(BASE + "/api/health");
console.log("/api/health →", await health.text());
const healthAi = await fetch(BASE + "/api/health/ai");
console.log("/api/health/ai sin sesión →", healthAi.status);
done();
