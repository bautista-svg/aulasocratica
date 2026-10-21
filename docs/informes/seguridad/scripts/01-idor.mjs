// Authorization / IDOR: teacher B uses every id of teacher A's workspace; a student of A's
// activity tries files of another activity. Every answer must be 404 (never 200/403).
import { Actor, setupTeacher, upload, check, done, sleep } from "./lib.mjs";

const A = await setupTeacher("Docente A");
const B = await setupTeacher("Docente B");

// ── A's content ──
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const up = await upload(A.t, `/api/activities/${A.activityId}/files`, [{ name: "texto.txt", data: "Material secreto de A", type: "text/plain" }]);
const fileId = up.data.files?.[0]?.id;
await sleep(1500);
const mat = await A.t.post("/api/materials", { kind: "text", title: "Material de A", body: "cuerpo privado" });
const materialId = mat.data.material.id;
const tutors = await A.t.get("/api/tutors");
const tutorId = tutors.data.tutors[0].id;
const custom = await A.t.post("/api/tutors", { name: "Tutor de A" });
const customTutorId = custom.data?.tutor?.id ?? tutorId;

// A student joins A's activity and chats.
const S = new Actor("alumno A");
const j = await S.post(`/api/s/${A.linkToken}/join`, { name: "Ana Alumna" });
check("alumno entra a la actividad de A", j.status === 201, String(j.status));
const chat = await S.post(`/api/s/${A.linkToken}/chat`, { text: "hola tutor" });
check("chat del alumno responde (SSE)", chat.status === 200, String(chat.status));
await sleep(500);
const roster = await A.t.get(`/api/classrooms/${A.classroomId}/students`);
const studentId = roster.data.students[0].id;
const sessionId = roster.data.students[0].sessions[0].sessionId;
const rep = await A.t.post("/api/reports", { kind: "individual", scope: { sessionId } });
const reportId = rep.data.report.id;
const alert = await A.t.post(`/api/classrooms/${A.classroomId}/alerts`, { name: "Alerta A", description: "Detectar algo", category: "academica", severity: "review" });
const alertId = alert.data.alert.id;

// ── B against A ──
const T = B.t;
const probes = [
  ["GET", `/api/classrooms/${A.classroomId}`],
  ["PATCH", `/api/classrooms/${A.classroomId}`, { name: "hack" }],
  ["DELETE", `/api/classrooms/${A.classroomId}`],
  ["GET", `/api/classrooms/${A.classroomId}/activities`],
  ["GET", `/api/classrooms/${A.classroomId}/students`],
  ["POST", `/api/classrooms/${A.classroomId}/students`, { names: ["Intruso"] }],
  ["PATCH", `/api/classrooms/${A.classroomId}/students/${studentId}`, { fullName: "Otro" }],
  ["DELETE", `/api/classrooms/${A.classroomId}/students/${studentId}`],
  ["PATCH", `/api/classrooms/${B.classroomId}/students/${studentId}`, { fullName: "Otro" }],
  ["DELETE", `/api/classrooms/${B.classroomId}/students/${studentId}`],
  ["GET", `/api/classrooms/${A.classroomId}/alerts`],
  ["PATCH", `/api/classrooms/${A.classroomId}/alerts/${alertId}`, { enabled: false }],
  ["PATCH", `/api/classrooms/${B.classroomId}/alerts/${alertId}`, { enabled: false }],
  ["DELETE", `/api/classrooms/${B.classroomId}/alerts/${alertId}`],
  ["PUT", `/api/classrooms/${A.classroomId}/alerts/builtin/left_app`, { enabled: false }],
  ["GET", `/api/activities/${A.activityId}`],
  ["PATCH", `/api/activities/${A.activityId}`, { title: "hack" }],
  ["POST", `/api/activities`, { classroomId: A.classroomId, title: "en aula ajena" }],
  ["POST", `/api/activities`, { classroomId: B.classroomId, title: "con tutor ajeno", tutorId: customTutorId }],
  ["POST", `/api/activities/${B.activityId}/tutor`, { tutorId: customTutorId }],
  ["POST", `/api/activities/${A.activityId}/publish`, {}],
  ["POST", `/api/activities/${A.activityId}/unpublish`, {}],
  ["POST", `/api/activities/${A.activityId}/duplicate`, {}],
  ["POST", `/api/activities/${B.activityId}/duplicate`, { classroomId: A.classroomId }],
  ["POST", `/api/activities/${A.activityId}/reset`, { confirm: "REINICIAR" }],
  ["DELETE", `/api/activities/${A.activityId}`, { confirm: "BORRAR" }],
  ["PATCH", `/api/activities/${A.activityId}/link`, { linkActive: false }],
  ["POST", `/api/activities/${A.activityId}/link/regenerate`, {}],
  ["GET", `/api/activities/${A.activityId}/files`],
  ["GET", `/api/activities/${A.activityId}/files/${fileId}/download`],
  ["GET", `/api/activities/${B.activityId}/files/${fileId}/download`],
  ["GET", `/api/activities/${B.activityId}/files/${fileId}/text`],
  ["PATCH", `/api/activities/${B.activityId}/files/${fileId}`, { teacherNote: "x" }],
  ["DELETE", `/api/activities/${B.activityId}/files/${fileId}`],
  ["POST", `/api/activities/${B.activityId}/files/${fileId}/retry`, {}],
  ["POST", `/api/activities/${A.activityId}/ai/rubric`, {}],
  ["GET", `/api/sessions/${sessionId}`],
  ["GET", `/api/sessions/${sessionId}/journey.pdf`],
  ["POST", `/api/sessions/${sessionId}/end`, {}],
  ["POST", `/api/sessions/${sessionId}/reopen`, {}],
  ["DELETE", `/api/sessions/${sessionId}`, { confirm: "BORRAR" }],
  ["POST", `/api/sessions/${sessionId}/summary`, { basis: [] }],
  ["POST", `/api/sessions/${sessionId}/xray/analyze`, {}],
  ["PUT", `/api/sessions/${sessionId}/rubric`, { levels: {}, comment: "", confirm: false }],
  ["GET", `/api/students/${studentId}`],
  ["GET", `/api/live/${A.activityId}`],
  ["GET", `/api/live/${A.activityId}/stream`],
  ["POST", `/api/live/${A.activityId}/end-all`, { confirm: "TERMINAR" }],
  ["GET", `/api/tutors/${customTutorId}`],
  ["PATCH", `/api/tutors/${customTutorId}`, { name: "hack" }],
  ["POST", `/api/tutors/${customTutorId}/duplicate`, {}],
  ["DELETE", `/api/tutors/${customTutorId}`],
  ["GET", `/api/materials/${materialId}`],
  ["PATCH", `/api/materials/${materialId}`, { title: "hack" }],
  ["GET", `/api/materials/${materialId}/text`],
  ["GET", `/api/materials/${materialId}/download`],
  ["POST", `/api/materials/${materialId}/attach`, { activityId: B.activityId }],
  ["DELETE", `/api/materials/${materialId}`],
  ["GET", `/api/reports/${reportId}`],
  ["PATCH", `/api/reports/${reportId}`, { title: "hack" }],
  ["POST", `/api/reports/${reportId}/refresh`, {}],
  ["GET", `/api/reports/${reportId}/export.csv`],
  ["GET", `/api/reports/${reportId}/export.pdf`],
  ["DELETE", `/api/reports/${reportId}`],
  ["POST", `/api/reports`, { kind: "individual", scope: { sessionId } }],
  ["POST", `/api/reports`, { kind: "individual", scope: { studentId } }],
  ["POST", `/api/reports`, { kind: "group", scope: { activityId: A.activityId } }],
  ["POST", `/api/reports`, { kind: "group", scope: { classroomId: A.classroomId } }],
  ["POST", `/api/planning/create`, { classroomId: B.classroomId, materialIds: [materialId], proposal: { title: "x", instructions: "y", objectives: "", teacherNotes: "", tutorType: "pensamiento_critico", helpLevel: "moderate", tutorGuidance: "", reflectionQuestions: [], materialRefs: [], activityType: "" } }],
  ["POST", `/api/planning/proposals`, { classroomId: A.classroomId, topic: "x", materialIds: [materialId] }],
];

for (const [method, path, json] of probes) {
  const ctl = new AbortController();
  const p = T.req(method, path, { json, headers: {} , signal: ctl.signal });
  const r = await Promise.race([p, sleep(4000).then(() => ({ status: "timeout" }))]);
  const ok = r.status === 404 || (r.status === 400 && method === "POST" && path.startsWith("/api/planning"));
  check(`B ${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, ok, `${r.status} ${typeof r.data === "object" ? r.data?.error?.code ?? "" : ""}`);
}

// A's data must be intact after B's attempts.
const still = await A.t.get(`/api/activities/${A.activityId}`);
check("la actividad de A sigue intacta", still.status === 200 && still.data.activity.title === "Actividad de Docente A" && still.data.files.length === 1);
const stillRoster = await A.t.get(`/api/classrooms/${A.classroomId}/students`);
check("el alumno de A sigue intacto", stillRoster.data.students.length === 1 && stillRoster.data.students[0].fullName === "Ana Alumna");

// ── Student side ──
// Student of A's activity asks for a file of B's activity through A's link.
const upB = await upload(B.t, `/api/activities/${B.activityId}/files`, [{ name: "b.txt", data: "Archivo de B", type: "text/plain" }]);
const fileB = upB.data.files?.[0]?.id;
await sleep(1500);
const cross = await S.get(`/api/s/${A.linkToken}/files/${fileB}`);
check("alumno de A no puede bajar archivo de la actividad B", cross.status === 404, String(cross.status));
const own = await S.get(`/api/s/${A.linkToken}/files/${fileId}`);
check("alumno de A baja su propio archivo", own.status === 200, `${own.status} ${own.headers.get("content-type")}`);
// Cookie of A's activity sent to B's link: cookie names are per activity → no session.
const SB = new Actor("alumno A en link B");
SB.cookies = new Map(S.cookies);
const crossLink = await SB.get(`/api/s/${B.linkToken}`);
check("cookie de alumno de A no abre sesión en el link de B", crossLink.status === 200 && crossLink.data.workspace === null);
const forged = new Actor("cookie de A renombrada para B");
const [, tokenA] = [...S.cookies][0];
forged.cookies.set(`as_s_${B.activityId.replace(/-/g, "")}`, tokenA);
const forgedChat = await forged.post(`/api/s/${B.linkToken}/chat`, { text: "hola" });
check("token de alumno de A con el nombre de cookie de B → 401", forgedChat.status === 401, String(forgedChat.status));
// Teacher cookie does not open student routes and vice versa.
const studentAsTeacher = await S.get(`/api/classrooms/${A.classroomId}`);
check("cookie de alumno no sirve para rutas de docente", studentAsTeacher.status === 401, String(studentAsTeacher.status));
// Link token enumeration
const bad = await new Actor("x").get(`/api/s/AAAAAAAAAAAAAAAAAAAAAA`);
check("token de enlace inexistente → 404", bad.status === 404);
console.log(`Entropía del token de enlace: ${A.linkToken.length} caracteres base64url (randomToken(16) = 128 bits)`);
done();
