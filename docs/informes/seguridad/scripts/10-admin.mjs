// Admin panel: lockout, cookie, data minimization. Plus the planning IDOR left from 01.
import { Actor, setupTeacher, check, done } from "./lib.mjs";

const PASS = process.env.ADMIN_PASSWORD ?? "sec-admin-password-123456";
const anon = new Actor("anon");
const ov = await anon.get("/api/admin/overview");
check("overview sin sesión → 401", ov.status === 401, String(ov.status));

const atk = new Actor("atacante");
const codes = [];
for (let i = 0; i < 6; i++) codes.push((await atk.post("/api/admin/login", { password: `adivinanza-${i}` })).status);
console.log("intentos fallidos de admin:", codes.join(","));
check("bloqueo por IP tras 5 fallos", codes[5] === 429, codes.join(","));
const locked = await atk.post("/api/admin/login", { password: PASS });
check("con la IP bloqueada, ni la contraseña correcta entra (bloqueo efectivo)", locked.status === 429);
console.log("nota: el bloqueo es por IP; con TRUST_PROXY=true la IP sale de CF-Connecting-IP/X-Forwarded-For (ver hallazgo de IP falsificable)");

// Seed one workspace with an e-mail and a student so the admin views have data.
const T = await setupTeacher("Docente Visible");
await T.t.post("/api/auth/register", { email: `visible.${Date.now()}@escuela.test`, password: "clave-larga-123" });
const st = new Actor("alumno");
await st.post(`/api/s/${T.linkToken}/join`, { name: "Nombre Secreto Alumno" });
console.log("(para entrar como admin hace falta otra IP o esperar 15 min: se reinicia la instancia antes de la segunda parte)");
if (process.argv[2] === "login") {
  const adm = new Actor("admin");
  const ok = await adm.post("/api/admin/login", { password: PASS });
  console.log("Set-Cookie admin:", ok.setCookies.join(" | ").replace(/as_admin=[^;]+/, "as_admin=<token>"));
  const o = await adm.get("/api/admin/overview");
  const w = await adm.get("/api/admin/workspaces");
  const blob = JSON.stringify([o.data, w.data]);
  check("overview/workspaces sin nombres de alumnos", !blob.includes("Nombre Secreto Alumno"));
  check("correos enmascarados", !/visible\.\d+@escuela\.test/.test(blob) && /v\*\*\*@e\*\*\*\.test/.test(blob));
  console.log("campos de un espacio en /admin/workspaces:", Object.keys(w.data.workspaces[0]).join(", "));
  const teacherAsAdmin = await T.t.get("/api/admin/overview");
  check("cookie de docente no da acceso admin", teacherAsAdmin.status === 401);
}

// Planning proposals with another workspace's material id (completes 01-idor).
const A = await setupTeacher("Docente Plan A");
const B = await setupTeacher("Docente Plan B");
const mat = await A.t.post("/api/materials", { kind: "text", title: "Material privado de A", body: "contenido privado" });
const pr = await B.t.post("/api/planning/proposals", { topic: "la fotosíntesis", materialIds: [mat.data.material.id] });
check("B no puede usar materiales de A en Crear con IA", pr.status === 404, `${pr.status} ${pr.data?.error?.code}`);
const pr2 = await B.t.post("/api/planning/proposals", { topic: "la fotosíntesis", classroomId: A.classroomId });
check("B no puede usar el aula de A en Crear con IA", pr2.status === 404, `${pr2.status} ${pr2.data?.error?.code}`);
done();
