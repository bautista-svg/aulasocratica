// Student identity: name collision, resume-code brute force & lockout, name enumeration,
// self-registration limits, what a link holder learns without a session.
import { Actor, setupTeacher, check, done } from "./lib.mjs";

const A = await setupTeacher("Docente Estudiantes");
const link = A.linkToken;

// Public info of the link for an anonymous visitor.
const anon = new Actor("anónimo");
const info = await anon.get(`/api/s/${link}`);
console.log("GET /api/s/:token sin sesión →", JSON.stringify(info.data));

// Student 1 joins.
const s1 = new Actor("Lucía (dispositivo 1)");
const j1 = await s1.post(`/api/s/${link}/join`, { name: "Lucía Fernández" });
check("Lucía entra", j1.status === 201);
const code = j1.data.workspace.resumeCode;
console.log("código de Lucía:", code, "(", code.length, "caracteres, alfabeto de 32 → 32^6 ≈ 1.07e9 )");
const cookieAttrs = j1.setCookies.join(" | ");
console.log("Set-Cookie del alumno:", cookieAttrs.replace(/=[A-Za-z0-9_-]{20,}/, "=<token>"));

// Name collision with normalization: another device types the same name with other accents/case.
const s2 = new Actor("atacante");
for (const variant of ["lucia fernandez", "LUCÍA  FERNÁNDEZ", "Lucia-Fernandez", "lucía.fernández!"]) {
  const r = await s2.post(`/api/s/${link}/join`, { name: variant });
  check(`join "${variant}" con trabajo existente → 409 resume_required (no se apodera)`, r.status === 409 && r.data.error.code === "resume_required", `${r.status} ${r.data?.error?.message ?? ""}`);
}
// Homoglyph: Cyrillic 'а' produces a different key → a second "Lucía Fernández" in the roster.
const homo = await s2.post(`/api/s/${link}/join`, { name: "Lucíа Fernández" /* а cirílica */ });
console.log("join con homoglifo (а cirílica):", homo.status, homo.data?.workspace?.studentName ?? homo.data?.error?.code);
const roster = await A.t.get(`/api/classrooms/${A.classroomId}/students`);
console.log("lista del aula:", roster.data.students.map((s) => JSON.stringify(s.fullName)).join(", "));

// Name enumeration via /resume (404 = no such name, 400 = name exists).
const e1 = await s2.post(`/api/s/${link}/resume`, { name: "Nombre Que No Existe", code: "AAAAAA" });
const e2 = await s2.post(`/api/s/${link}/resume`, { name: "Lucía Fernández", code: "AAAAAA" });
console.log(`resume nombre inexistente → ${e1.status} ${e1.data.error.code}; nombre existente → ${e2.status} ${e2.data.error.code}`);
check("resume distingue nombres existentes (enumeración de nombres de alumnos)", e1.status !== e2.status, `${e1.status} vs ${e2.status}`);

// Per-session lockout: 5 wrong codes, then even the right code is refused (15 min).
let last;
for (let i = 0; i < 6; i++) last = await s2.post(`/api/s/${link}/resume`, { name: "Lucía Fernández", code: `ZZZZZ${i}` });
console.log("tras 6 intentos fallidos:", last.status, last.data.error.code);
const right = await s2.post(`/api/s/${link}/resume`, { name: "Lucía Fernández", code });
check("con el bloqueo activo el código correcto también se rechaza (bloqueo por sesión)", right.status === 429 && right.data.error.code === "locked", `${right.status} ${right.data.error.code}`);
// The real student on her own device is unaffected (cookie session).
const own = await s1.get(`/api/s/${link}`);
check("la alumna sigue trabajando en su dispositivo durante el bloqueo", own.data.workspace?.studentName === "Lucía Fernández");

// Per-IP code limit (30 / 10 min): enumerate names until the IP limit kicks in.
let ipLimited = 0;
for (let i = 0; i < 40; i++) {
  const r = await s2.post(`/api/s/${link}/resume`, { name: `Alumno Prueba ${String.fromCharCode(65 + (i % 26))}${i}`, code: "AAAAAA" });
  if (r.status === 429 && r.data.error.code === "rate_limited") ipLimited++;
}
check("límite por IP de /resume se activa (30 / 10 min)", ipLimited > 0, `${ipLimited} respuestas 429 de 40`);

// Roster names loaded by the teacher can be claimed by anyone with the link (no work yet).
await A.t.post(`/api/classrooms/${A.classroomId}/students`, { names: ["Mateo Gómez"] });
const claim = await new Actor("impostor").post(`/api/s/${link}/join`, { name: "mateo gomez" });
check("cualquiera con el enlace puede tomar un nombre de la lista que todavía no entró", claim.status === 201, `${claim.status} → ${claim.data?.workspace?.studentName}`);
const real = await new Actor("Mateo real").post(`/api/s/${link}/join`, { name: "Mateo Gómez" });
console.log("el Mateo real después →", real.status, real.data?.error?.code);

// The workspace payload of a student never includes other students.
const ws = JSON.stringify(j1.data.workspace);
check("el workspace del alumno no menciona a otros alumnos", !ws.includes("Mateo") && !ws.includes("Prueba"));

// Self-registration: each new name creates a student row in the classroom (cap 400 per activity).
const before = (await A.t.get(`/api/classrooms/${A.classroomId}/students`)).data.students.length;
const spam = new Actor("spam");
let created = 0;
for (let i = 0; i < 70; i++) {
  const r = await spam.post(`/api/s/${link}/join`, { name: `Bot Numero ${i} Xx` });
  spam.cookies.clear();
  if (r.status === 201) created++;
  else if (r.status === 429) break;
}
const after = (await A.t.get(`/api/classrooms/${A.classroomId}/students`)).data.students.length;
console.log(`alta masiva desde una IP: ${created} alumnos creados antes del límite (60 / 10 min por IP y actividad); lista del aula ${before} → ${after}`);

// Leave works even with a closed link and revokes the token.
const saved = new Map(s1.cookies);
const leave = await s1.post(`/api/s/${link}/leave`, {});
const replay = new Actor("token viejo");
replay.cookies = saved;
const afterLeave = await replay.get(`/api/s/${link}`);
check("'No soy yo' revoca el token del dispositivo (reusar la cookie vieja no abre la sesión)", leave.status === 200 && afterLeave.data.workspace === null);
done();
