// Teacher sessions & accounts: enumeration, merge on sign-in, revocation (password change,
// logout), recovery-code rotation, and the recovery code surviving a password change.
// Run on a freshly started instance (in-memory rate limits).
import { Actor, BASE, check, done } from "./lib.mjs";

const EMAIL = `docente.${Date.now()}@ejemplo.test`;
const PW = "clave-de-prueba-123";

// Device 1: anonymous workspace → account.
const d1 = new Actor("dispositivo 1");
await d1.post("/api/auth/start", {});
await d1.post("/api/classrooms", { name: "Aula del dispositivo 1" });
const reg = await d1.post("/api/auth/register", { email: EMAIL, password: PW });
check("registro devuelve código de recuperación", reg.status === 200 && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(reg.data.recoveryCode), reg.data.recoveryCode);
const tokenLen = d1.cookies.get("as_t").length;
console.log(`token de sesión docente: ${tokenLen} caracteres base64url (32 bytes aleatorios), guardado como SHA-256`);

// Enumeration through /register.
const other = new Actor("otro");
await other.post("/api/auth/start", {});
const dup = await other.post("/api/auth/register", { email: EMAIL.toUpperCase(), password: "otra-clave-larga" });
console.log("registro con correo existente →", dup.status, dup.data.error.message);
check("/register revela si un correo ya tiene cuenta (enumeración)", dup.status === 409);

// Timing: unknown e-mail (no scrypt) vs known e-mail with wrong password (scrypt).
const time = async (email) => {
  const a = new Actor("t");
  const t0 = performance.now();
  const r = await a.post("/api/auth/login", { email, password: "incorrecta-123" });
  return { ms: performance.now() - t0, status: r.status };
};
const unknown = [], known = [];
for (let i = 0; i < 3; i++) {
  unknown.push(await time(`no.existe.${i}@ejemplo.test`));
  known.push(await time(EMAIL));
}
const avg = (l) => Math.round(l.reduce((n, x) => n + x.ms, 0) / l.length);
console.log(`login: correo inexistente ≈ ${avg(unknown)} ms vs correo existente ≈ ${avg(known)} ms (status ${unknown[0].status}/${known[0].status})`);

// Device 2: anonymous workspace with content signs in → merged into the account.
const d2 = new Actor("dispositivo 2");
await d2.post("/api/auth/start", {});
const anonRoom = await d2.post("/api/classrooms", { name: "Aula anónima del dispositivo 2" });
const login = await d2.post("/api/auth/login", { email: EMAIL, password: PW });
check("login fusiona el espacio anónimo con contenido", login.status === 200 && login.data.merged === true, JSON.stringify(login.data.merged));
const rooms1 = await d1.get("/api/classrooms");
check("la cuenta ahora tiene el aula del dispositivo 2", rooms1.data.classrooms.some((c) => c.id === anonRoom.data.classroom.id));

// Recovery code rotation needs no re-authentication.
const rot = await d2.post("/api/auth/recovery-code", {});
check("rotar el código de recuperación no pide la contraseña", rot.status === 200 && Boolean(rot.data.recoveryCode), String(rot.status));
const code2 = rot.data.recoveryCode;

// Password change on device 1 revokes device 2.
const d2Saved = new Map(d2.cookies);
const chg = await d1.post("/api/auth/password", { currentPassword: PW, newPassword: "clave-nueva-456789" });
check("cambio de contraseña ok", chg.status === 200);
const replay = new Actor("replay d2");
replay.cookies = d2Saved;
const me2 = await replay.get("/api/auth/me");
check("cambio de contraseña cierra las otras sesiones", me2.data.teacher === null);

// The recovery code rotated by device 2 still works after the password change.
const attacker = new Actor("quien tenía el código");
const rec = await attacker.post("/api/auth/recover", { email: EMAIL, recoveryCode: code2, newPassword: "clave-del-atacante-1" });
check("el código de recuperación sigue sirviendo después del cambio de contraseña", rec.status === 200, String(rec.status));
const me1 = await d1.get("/api/auth/me");
check("recover cierra todas las sesiones previas (incluida la del dueño)", me1.data.teacher === null);

// Logout revokes the token server-side.
const saved = new Map(attacker.cookies);
await attacker.post("/api/auth/logout", {});
const r = new Actor("replay logout");
r.cookies = saved;
const me3 = await r.get("/api/auth/me");
check("logout invalida el token en el servidor", me3.data.teacher === null);

// Anonymous workspaces cannot log out.
const anon = new Actor("anon");
await anon.post("/api/auth/start", {});
const lo = await anon.post("/api/auth/logout", {});
check("espacio anónimo no puede cerrar sesión (se perdería)", lo.status === 400);

// Login rate limits: per IP 10/15 min and per e-mail 8/15 min (anyone can lock a known e-mail).
let lockedEmail = false;
for (let i = 0; i < 6; i++) {
  const x = await new Actor("x").post("/api/auth/login", { email: EMAIL, password: "mal" + i });
  if (x.status === 429) {
    lockedEmail = true;
    console.log(`login bloqueado tras ${i + 1} intentos más: ${x.data.error.message}`);
    break;
  }
}
check("límite de login activo", lockedEmail);
done();
