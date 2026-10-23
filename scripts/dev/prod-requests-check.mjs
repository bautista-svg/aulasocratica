// Checks "Pedidos de cambios" against a deployed instance with the real model, in a throwaway
// account deleted at the end: access by email, a two-turn conversation with a screenshot, the
// summary, sending it, the admin list and answer. Reads ADMIN_PASSWORD from the secrets file
// (never printed). Costs a few cents.
//   node scripts/dev/prod-requests-check.mjs [https://aulasocratica.becode.com.ar]
import fs from "node:fs";

const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
const SECRETS = process.env.AULA_SECRETS ?? "C:\\Users\\gonib\\Downloads\\coolify-conexion\\aulasocratica-secrets.env";
// 1×1 PNG: enough to check the screenshot path end to end.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
let failed = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    store(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
  };
}
async function req(j, method, path, body, form) {
  const headers = { origin: BASE, "x-aula-client": "1", cookie: j.header() };
  if (!form && body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  j.store(res);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}
function adminPassword() {
  const line = fs.readFileSync(SECRETS, "utf8").split(/\r?\n/).find((l) => /^\s*ADMIN_PASSWORD\s*=/.test(l));
  if (!line) throw new Error("No ADMIN_PASSWORD in the secrets file");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const teacher = jar();
const admin = jar();
const email = `prueba.pedidos.${Date.now()}@example.com`;
try {
  ok("start workspace", (await req(teacher, "POST", "/api/auth/start", {})).status === 201);
  ok("register throwaway account", (await req(teacher, "POST", "/api/auth/register", { email, password: `clave-${Date.now()}-prueba` })).status === 200);
  ok("hidden before access", (await req(teacher, "GET", "/api/requests")).status === 403);
  ok("admin login", (await req(admin, "POST", "/api/admin/login", { password: adminPassword() })).status === 200);
  const on = await req(admin, "POST", "/api/admin/requests-access", { email, enabled: true });
  ok("enable access by email", on.status === 200 && on.data.teacher?.enabled === true);
  const me = await req(teacher, "GET", "/api/auth/me");
  ok("me.canRequestChanges", me.data.teacher?.canRequestChanges === true);

  const created = await req(teacher, "POST", "/api/requests");
  const id = created.data.request?.id;
  ok("new request with greeting", created.status === 201 && created.data.request.messages.length === 1);

  const form = new FormData();
  form.set("text", "Quiero que los alumnos puedan ver los criterios de la rúbrica antes de empezar.");
  form.append("file", new Blob([PNG], { type: "image/png" }), "captura.png");
  const sent = await req(teacher, "POST", `/api/requests/${id}/messages`, undefined, form);
  ok("message with screenshot saved", sent.status === 200 && sent.data.request.images.length === 1 && sent.data.request.awaitingReply === true);
  const shot = await fetch(BASE + sent.data.request.images[0].url, { headers: { cookie: teacher.header() } });
  ok("screenshot served to her", shot.status === 200 && shot.headers.get("content-type") === "image/png");

  let t0 = Date.now();
  const r1 = await req(teacher, "POST", `/api/requests/${id}/reply`);
  const a1 = r1.data.request;
  ok("AI asks (turn 1)", r1.status === 200 && a1.messages.at(-1).role === "assistant", `${((Date.now() - t0) / 1000).toFixed(1)} s · ready=${a1?.ready} · «${a1?.messages.at(-1).text}»`);
  ok("summary filled", Boolean(a1?.summary?.title && a1.summary.desired), `[${a1?.summary?.kind}] ${a1?.summary?.title} · ${a1?.summary?.screen}`);

  const form2 = new FormData();
  form2.set("text", "Solo los nombres de los criterios, sin los niveles, en la pantalla de la consigna. En todas las actividades que tengan rúbrica.");
  await req(teacher, "POST", `/api/requests/${id}/messages`, undefined, form2);
  t0 = Date.now();
  const r2 = await req(teacher, "POST", `/api/requests/${id}/reply`);
  const a2 = r2.data.request;
  ok("AI answers (turn 2)", r2.status === 200, `${((Date.now() - t0) / 1000).toFixed(1)} s · ready=${a2?.ready} · «${a2?.messages.at(-1).text}»`);
  console.log(`     details: ${a2?.summary?.details.join(" | ")}`);

  const submitted = await req(teacher, "POST", `/api/requests/${id}/submit`);
  ok("sent", submitted.data.request?.status === "pending");
  const list = await req(admin, "GET", "/api/admin/requests");
  const mine = list.data.requests?.find((x) => x.id === id);
  ok("admin sees it with her email", Boolean(mine) && mine.teacher.email === email);
  const done = await req(admin, "PATCH", `/api/admin/requests/${id}`, { status: "done", note: "Prueba automática." });
  ok("admin answers", done.data.request?.status === "done");
  ok("she sees the answer", (await req(teacher, "GET", `/api/requests/${id}`)).data.request?.note === "Prueba automática.");
} catch (err) {
  failed++;
  console.log(`FAIL unexpected — ${err.message}`);
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("throwaway account deleted", del.status === 200);
  console.log(failed ? `\n${failed} failed` : "\nAll OK");
  process.exitCode = failed ? 1 : 0;
}
