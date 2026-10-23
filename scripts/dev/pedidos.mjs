// "Pedidos de cambios" from the terminal, through the admin API: read what teachers asked for
// (summary, conversation, screenshots) and answer them. The admin password is read from the
// secrets file and never printed.
//   node scripts/dev/pedidos.mjs                      pending and in progress (default)
//   node scripts/dev/pedidos.mjs --all                every request (also done / discarded)
//   node scripts/dev/pedidos.mjs --json               the raw JSON
//   node scripts/dev/pedidos.mjs estado <id> <pending|in_progress|done|discarded> ["nota para la docente"]
//   node scripts/dev/pedidos.mjs acceso <email> [on|off]
// Env: PEDIDOS_URL (default production), AULA_SECRETS (path to the env file with ADMIN_PASSWORD).
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.PEDIDOS_URL ?? "https://aulasocratica.becode.com.ar").replace(/\/$/, "");
const SECRETS = process.env.AULA_SECRETS ?? "C:\\Users\\gonib\\Downloads\\coolify-conexion\\aulasocratica-secrets.env";
const OUT = path.resolve(".pedidos");

function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const text = fs.readFileSync(SECRETS, "utf8");
  const line = text.split(/\r?\n/).find((l) => /^\s*ADMIN_PASSWORD\s*=/.test(l));
  if (!line) throw new Error(`No hay ADMIN_PASSWORD en ${SECRETS}`);
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

let cookie = "";
async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(";")[0];
    if (pair.startsWith("as_admin=")) cookie = pair;
  }
  return res;
}
async function json(method, url, body) {
  const res = await call(method, url, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${data.error?.message ?? data.message ?? ""}`.trim());
  return data;
}

async function login() {
  await json("POST", "/api/admin/login", { password: adminPassword() });
}

const STATUS = { pending: "ENVIADO", in_progress: "EN CURSO", done: "HECHO", discarded: "DESCARTADO" };
const KIND = { fix: "Algo no funciona", change: "Cambiar algo que existe", new: "Algo nuevo" };

async function download(r) {
  const files = [];
  if (!r.images.length) return files;
  const dir = path.join(OUT, r.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const img of r.images) {
    const target = path.join(dir, `${img.id}-${img.name.replace(/[^\w.-]+/g, "_")}`);
    if (!fs.existsSync(target)) {
      const res = await call("GET", img.url);
      if (!res.ok) continue;
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    }
    files.push({ id: img.id, path: target });
  }
  return files;
}

function show(r, files) {
  const s = r.summary;
  const line = "─".repeat(72);
  console.log(`\n${line}\n[${STATUS[r.status] ?? r.status}] ${r.title || "(sin título)"}`);
  console.log(`id: ${r.id}`);
  console.log(`de: ${r.teacher.name || "(sin nombre)"} <${r.teacher.email ?? "sin correo"}> · enviado ${r.submittedAt ?? "—"}${r.ready ? "" : " · la IA todavía tenía preguntas"}`);
  if (s) {
    console.log(`tipo: ${KIND[s.kind] ?? s.kind}`);
    if (s.screen) console.log(`dónde: ${s.screen}`);
    if (s.today) console.log(`hoy: ${s.today}`);
    if (s.desired) console.log(`quiere: ${s.desired}`);
    for (const d of s.details) console.log(`  - ${d}`);
  }
  if (r.note) console.log(`nota del equipo: ${r.note}`);
  console.log("conversación:");
  const byId = new Map(files.map((f) => [f.id, f.path]));
  for (const m of r.messages) {
    const who = m.role === "teacher" ? "DOCENTE" : "IA";
    console.log(`  ${who}: ${m.text.replace(/\n/g, "\n    ")}`);
    for (const id of m.imageIds) console.log(`    [captura] ${byId.get(id) ?? id}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

try {
  await login();
  if (cmd === "estado") {
    const [id, status, ...note] = rest;
    if (!id || !status) throw new Error("Uso: estado <id> <pending|in_progress|done|discarded> [nota]");
    const body = { status, ...(note.length ? { note: note.join(" ") } : {}) };
    const { request } = await json("PATCH", `/api/admin/requests/${id}`, body);
    console.log(`Listo: "${request.title}" → ${STATUS[request.status] ?? request.status}${request.note ? ` · nota: ${request.note}` : ""}`);
  } else if (cmd === "acceso") {
    const [email, onOff = "on"] = rest;
    if (!email) throw new Error("Uso: acceso <email> [on|off]");
    const { teacher } = await json("POST", "/api/admin/requests-access", { email, enabled: onOff !== "off" });
    console.log(`Pedidos de cambios ${teacher.enabled ? "habilitado" : "deshabilitado"} para ${teacher.email} (${teacher.name || "sin nombre"}).`);
  } else {
    const status = flags.has("--all") ? "all" : "";
    const { requests } = await json("GET", `/api/admin/requests${status ? `?status=${status}` : ""}`);
    if (flags.has("--json")) {
      console.log(JSON.stringify(requests, null, 2));
    } else if (!requests.length) {
      console.log("No hay pedidos pendientes.");
    } else {
      console.log(`${requests.length} pedido(s):`);
      for (const r of requests) show(r, await download(r));
    }
  }
} catch (err) {
  console.error(String(err.message ?? err));
  process.exitCode = 1;
}
