// Abuse / DoS. Start the instance with TRUST_PROXY=true and AI_DAILY_TOKENS_PER_WORKSPACE=1000
// (the local AI simulator reports 80 tokens per call) to observe, quickly:
//  a) forwarding headers spoofed by a client that reaches the origin directly,
//  b) a student (any link holder) exhausting the teacher's daily AI budget,
//  c) unbounded SSE connections,
//  d) disk amplification through "Duplicar" (no rate limit, no per-workspace quota).
import fs from "node:fs";
import path from "node:path";
import { Actor, BASE, setupTeacher, upload, check, done, sleep } from "./lib.mjs";

// a) CF-Connecting-IP / X-Forwarded-For are trusted from any client when TRUST_PROXY=true.
let created = 0;
for (let i = 0; i < 30; i++) {
  const r = await fetch(BASE + "/api/auth/start", {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json", "cf-connecting-ip": `203.0.113.${i}` },
    body: "{}",
  });
  if (r.status === 201) created++;
}
check("con CF-Connecting-IP rotado se crean más de 20 espacios por hora (límite por IP evadido)", created > 20, `${created}/30 creados`);
let xff = 0;
for (let i = 0; i < 25; i++) {
  const r = await fetch(BASE + "/api/auth/start", {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json", "x-forwarded-for": `198.51.100.${i}, 10.0.0.1` },
    body: "{}",
  });
  if (r.status === 201) xff++;
}
check("con X-Forwarded-For rotado (primer valor) también se evade", xff > 20, `${xff}/25 creados`);

// b) Budget exhaustion by a student.
const A = await setupTeacher("Docente Presupuesto");
const s = new Actor("alumno");
await s.post(`/api/s/${A.linkToken}/join`, { name: "Alumno Gastador" }, { headers: { "cf-connecting-ip": "192.0.2.10" } });
let quotaAt = null;
for (let i = 1; i <= 25; i++) {
  const r = await s.post(`/api/s/${A.linkToken}/chat`, { text: `mensaje número ${i} para gastar` });
  if (r.status === 429 && r.data?.error?.code === "ai_quota") {
    quotaAt = i;
    break;
  }
  await sleep(150);
}
check("un alumno agota el presupuesto diario de IA del docente", quotaAt !== null, `ai_quota en el mensaje ${quotaAt}`);
const teacherAi = await A.t.post(`/api/activities/${A.activityId}/ai/rubric`, {});
check("después, las funciones de IA del docente también fallan (429 ai_quota)", teacherAi.status === 429 && teacherAi.data.error.code === "ai_quota", `${teacherAi.status} ${teacherAi.data?.error?.code}`);
const otherStudent = new Actor("otra alumna");
await otherStudent.post(`/api/s/${A.linkToken}/join`, { name: "Alumna Inocente" }, { headers: { "cf-connecting-ip": "192.0.2.11" } });
const blocked = await otherStudent.post(`/api/s/${A.linkToken}/chat`, { text: "hola" });
check("y el resto de la clase se queda sin tutor por el día", blocked.status === 429, `${blocked.status} ${blocked.data?.error?.message ?? ""}`);

// c) SSE: open many live streams with one teacher session; all are accepted.
const controllers = [];
let opened = 0;
for (let i = 0; i < 150; i++) {
  const ctl = new AbortController();
  controllers.push(ctl);
  try {
    const r = await fetch(`${BASE}/api/live/${A.activityId}/stream`, { headers: { cookie: A.t.cookieHeader() }, signal: ctl.signal });
    if (r.status === 200) opened++;
  } catch {
    /* ignore */
  }
}
check("SSE sin límite de conexiones por docente", opened === 150, `${opened}/150 abiertas`);
for (const c of controllers) c.abort();

// d) Disk amplification with "Duplicar".
const dataDir = path.resolve(process.env.DATA_DIR_PATH ?? "data-sec/uploads");
const du = (dir) => {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? du(p) : fs.statSync(p).size;
  }
  return n;
};
const B = await setupTeacher("Docente Disco");
const fiveMb = Buffer.alloc(5 * 1024 * 1024, 65);
await upload(B.t, `/api/activities/${B.activityId}/files`, [1, 2, 3, 4].map((i) => ({ name: `relleno-${i}.txt`, data: fiveMb, type: "text/plain" })));
const before = du(dataDir);
let dups = 0;
const t0 = Date.now();
for (let i = 0; i < 15; i++) {
  const r = await B.t.post(`/api/activities/${B.activityId}/duplicate`, {});
  if (r.status === 201) dups++;
}
const after = du(dataDir);
console.log(`15 duplicados en ${Date.now() - t0} ms: ${dups} OK; disco ${Math.round(before / 1e6)} MB → ${Math.round(after / 1e6)} MB (cada copia duplica los 20 MB de archivos)`);
check("Duplicar no tiene límite de frecuencia ni cuota de disco", dups === 15 && after - before >= 15 * 20 * 1e6 * 0.95);
done();
