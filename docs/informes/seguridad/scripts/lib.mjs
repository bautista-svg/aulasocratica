// Helpers for the security test scripts (run against a LOCAL instance only).
// Usage: BASE=http://localhost:4600 node docs/informes/seguridad/scripts/<script>.mjs
export const BASE = process.env.BASE ?? "http://localhost:4600";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  throw new Error("Estos scripts solo corren contra una instancia local.");
}

/** Minimal cookie jar per "actor" (teacher A, teacher B, student…). */
export class Actor {
  constructor(name, { origin = BASE, client = true } = {}) {
    this.name = name;
    this.cookies = new Map();
    this.origin = origin;
    this.client = client;
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  store(res) {
    const list = res.headers.getSetCookie?.() ?? [];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (!v || expired) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    return list;
  }
  async req(method, path, { json, body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();
    if (method !== "GET" && method !== "HEAD") {
      if (this.origin && !("origin" in h)) h.origin = this.origin;
      if (this.client && !("x-aula-client" in h)) h["x-aula-client"] = "1";
    }
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h["content-type"] = "application/json";
    }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
    const setCookies = this.store(res);
    if (raw) return { res, setCookies };
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers, setCookies };
  }
  get(p, o) {
    return this.req("GET", p, o);
  }
  post(p, json, o = {}) {
    return this.req("POST", p, { ...o, json });
  }
  patch(p, json, o = {}) {
    return this.req("PATCH", p, { ...o, json });
  }
  put(p, json, o = {}) {
    return this.req("PUT", p, { ...o, json });
  }
  del(p, json, o = {}) {
    return this.req("DELETE", p, { ...o, json });
  }
}

let failures = 0;
export function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? `  -> ${detail}` : ""}`);
}
export function done() {
  console.log(failures ? `\n${failures} verificaciones fallaron` : "\nTodas las verificaciones pasaron");
}

/** Teacher with a workspace, a classroom and a published activity (+ link token). */
export async function setupTeacher(name) {
  const t = new Actor(name);
  const s = await t.post("/api/auth/start", { displayName: name });
  if (s.status !== 201) throw new Error(`start ${s.status} ${JSON.stringify(s.data)}`);
  const room = await t.post("/api/classrooms", { name: `Aula de ${name}` });
  const classroomId = room.data.classroom.id;
  const act = await t.post("/api/activities", { classroomId, title: `Actividad de ${name}` });
  const activity = act.data.activity;
  await t.patch(`/api/activities/${activity.id}`, { instructions: "Pensá por qué el cielo es azul.", requireInitialAnswer: false });
  await t.post(`/api/activities/${activity.id}/publish`, {});
  return { t, classroomId, activityId: activity.id, linkToken: activity.linkToken, teacherId: s.data.teacher.id };
}

export async function upload(actor, path, files, field = "file") {
  const fd = new FormData();
  for (const f of files) fd.append(field, new Blob([f.data], { type: f.type ?? "" }), f.name);
  const h = { origin: BASE, "x-aula-client": "1" };
  if (actor.cookies.size) h.cookie = actor.cookieHeader();
  const res = await fetch(BASE + path, { method: "POST", headers: h, body: fd });
  actor.store(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
