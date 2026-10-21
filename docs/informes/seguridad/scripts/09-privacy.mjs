// Deletion completeness (minors' data): files on disk, reports that keep copies of a deleted
// student's name and answers, library files after a merge, workspace deletion.
import fs from "node:fs";
import path from "node:path";
import { Actor, setupTeacher, upload, check, done, sleep } from "./lib.mjs";

const UP = path.resolve(process.env.UPLOADS ?? "data-sec/uploads");
const exists = (key) => fs.existsSync(path.join(UP, key));
const listUnder = (rel) => {
  const dir = path.join(UP, rel);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

const A = await setupTeacher("Docente Privacidad");
await upload(A.t, `/api/activities/${A.activityId}/files`, [{ name: "lectura.txt", data: "texto de la lectura", type: "text/plain" }]);
const s = new Actor("alumna");
await s.post(`/api/s/${A.linkToken}/join`, { name: "Sofía Ramírez" });
await s.post(`/api/s/${A.linkToken}/chat`, { text: "creo que es por la dispersión de la luz" });
await sleep(500);
await s.post(`/api/s/${A.linkToken}/finish`, { finalAnswer: "Mi respuesta final privada: la luz azul se dispersa más.", reflection: [] });
const roster = await A.t.get(`/api/classrooms/${A.classroomId}/students`);
const student = roster.data.students[0];
const sessionId = student.sessions[0].sessionId;

const ind = await A.t.post("/api/reports", { kind: "individual", scope: { sessionId } });
const grp = await A.t.post("/api/reports", { kind: "group", scope: { activityId: A.activityId } });
const hasStudent = (r) => JSON.stringify(r).includes("Sofía Ramírez");
const hasAnswer = (r) => JSON.stringify(r).includes("respuesta final privada");
check("informe individual contiene nombre y respuesta de la alumna", hasStudent(ind.data.report) && hasAnswer(ind.data.report));

// Teacher deletes the student (privacy request).
const del = await A.t.del(`/api/classrooms/${A.classroomId}/students/${student.id}`);
check("borrar alumno ok", del.status === 200);
const indAfter = await A.t.get(`/api/reports/${ind.data.report.id}`);
const grpAfter = await A.t.get(`/api/reports/${grp.data.report.id}`);
console.log(`después de borrar a la alumna: informe individual contiene nombre=${hasStudent(indAfter.data.report)} respuesta=${hasAnswer(indAfter.data.report)}; informe grupal contiene nombre=${hasStudent(grpAfter.data.report)}`);
check("los informes guardados conservan nombre/respuestas de una alumna borrada", hasStudent(indAfter.data.report) || hasStudent(grpAfter.data.report));
const csv = await A.t.get(`/api/reports/${ind.data.report.id}/export.csv`);
check("y se siguen exportando (CSV)", typeof csv.data === "string" && csv.data.includes("Sofía Ramírez"));

// Activity deletion removes its files from disk.
const actFilesBefore = listUnder(`activities/${A.activityId}`);
await A.t.del(`/api/activities/${A.activityId}`, { confirm: "BORRAR" });
check("borrar actividad elimina sus archivos del disco", actFilesBefore.length === 1 && listUnder(`activities/${A.activityId}`).length === 0, `${actFilesBefore.length} → ${listUnder(`activities/${A.activityId}`).length}`);

// Library file in an anonymous workspace, merged into an account, then the account is deleted.
const anon = new Actor("anónimo con biblioteca");
await anon.post("/api/auth/start", {});
const anonId = (await anon.get("/api/auth/me")).data.teacher.id;
const lib = await upload(anon, "/api/materials/files", [{ name: "guia.txt", data: "guía de estudio", type: "text/plain" }]);
check("archivo de biblioteca guardado", lib.status === 201 && listUnder(`library/${anonId}`).length === 1);
const acct = new Actor("cuenta");
await acct.post("/api/auth/start", {});
const email = `priv.${Date.now()}@ejemplo.test`;
await acct.post("/api/auth/register", { email, password: "clave-larga-123" });
const lg = await anon.post("/api/auth/login", { email, password: "clave-larga-123" });
check("fusión del espacio anónimo con biblioteca", lg.data.merged === true);
const w = await anon.del("/api/auth/workspace", { confirm: "BORRAR" });
check("borrar el espacio (cuenta) ok", w.status === 200);
check("el archivo de biblioteca movido por la fusión se borra del disco", listUnder(`library/${anonId}`).length === 0, `${listUnder(`library/${anonId}`).length} archivos quedan en library/${anonId}`);

// Classroom deletion removes activity files.
const C = await setupTeacher("Docente Aula Borrada");
await upload(C.t, `/api/activities/${C.activityId}/files`, [{ name: "a.txt", data: "a", type: "text/plain" }]);
await C.t.del(`/api/classrooms/${C.classroomId}`);
check("borrar aula elimina archivos de sus actividades", listUnder(`activities/${C.activityId}`).length === 0);
const leftDirs = fs.existsSync(path.join(UP, "activities", C.activityId));
console.log(`carpeta vacía activities/${C.activityId} queda en disco: ${leftDirs}`);
done();
