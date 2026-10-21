// Seeds a workspace whose every user-controlled field carries an HTML/JS payload, so the
// teacher and student screens can be inspected in a browser (see INFORME.md, XSS section).
// Prints the cookies to load in the browser of the local instance.
import { Actor, setupTeacher, upload, sleep } from "./lib.mjs";

const P = (tag) => `<img src=x data-xss="${tag}" onerror="window.__xss='${tag}'"><script>window.__xss='${tag}'</script>"'><svg/onload=window.__xss='${tag}'>{{7*7}}`;

const A = await setupTeacher("Docente XSS");
const t = A.t;
await t.patch("/api/auth/me", { displayName: `Prof ${P("teacher-name")}`.slice(0, 80) });
await t.patch(`/api/classrooms/${A.classroomId}`, { name: `Aula ${P("classroom")}`.slice(0, 120), school: P("school").slice(0, 100) });
await t.patch(`/api/activities/${A.activityId}`, {
  title: `Act ${P("title")}`.slice(0, 160),
  subject: P("subject").slice(0, 80),
  objectives: `Objetivo **negrita** [link](javascript:alert(1)) ${P("objectives")}`,
  instructions: `Consigna ${P("instructions")} [click](javascript:window.__xss='md-link')`,
  material: `Material ${P("material")}`,
  tutorRules: P("rules"),
  requireInitialAnswer: false,
});
const lvl = (n) => ({ label: P(`level-${n}`).slice(0, 40), description: P(`level-desc-${n}`).slice(0, 300) });
await t.patch(`/api/activities/${A.activityId}`, { rubric: [{ name: P("rubric").slice(0, 120), description: P("rubric-desc"), levels: [lvl(0), lvl(1), lvl(2)] }] });
await t.patch(`/api/activities/${A.activityId}`, { reflectionQuestions: [{ key: "q1", question: P("reflection").slice(0, 300) }] });
await upload(t, `/api/activities/${A.activityId}/files`, [{ name: `${P("filename")}.txt`.slice(0, 200), data: P("file-content"), type: "text/plain" }]);
await t.post("/api/materials", { kind: "link", title: P("mat-title").slice(0, 200), url: "https://example.com/?q=<script>", body: P("mat-body") });
await t.post(`/api/classrooms/${A.classroomId}/alerts`, { name: P("alert").slice(0, 80), description: P("alert-desc").slice(0, 400), category: "seguridad", severity: "immediate" });
await t.post("/api/tutors", { name: P("tutor").slice(0, 120), rules: P("tutor-rules") });

const s = new Actor("alumno xss");
const j = await s.post(`/api/s/${A.linkToken}/join`, { name: `Juan ${P("student-name")}`.slice(0, 120) });
if (j.status !== 201) console.log("join", j.status, j.data);
await s.post(`/api/s/${A.linkToken}/chat`, { text: `Mensaje ${P("message")}\n\n- lista ${P("list")}\n**${P("bold")}** \`${P("code")}\` [x](javascript:window.__xss='msg-link')` });
await sleep(800);
await s.post(`/api/s/${A.linkToken}/signal`, { kind: "pasted_text", chars: 500 });
await s.post(`/api/s/${A.linkToken}/finish`, { finalAnswer: `Final ${P("final")}`, reflection: [{ key: "q1", answer: P("reflection-answer") }] });
const roster = await t.get(`/api/classrooms/${A.classroomId}/students`);
const studentId = roster.data.students[0].id;
const sessionId = roster.data.students[0].sessions[0].sessionId;
await t.put(`/api/sessions/${sessionId}/rubric`, { levels: {}, comment: P("rubric-comment"), confirm: false });
const rep = await t.post("/api/reports", { kind: "individual", scope: { sessionId }, title: `Informe ${P("report-title")}`.slice(0, 200) });
const reportId = rep.data.report?.id;
if (reportId) {
  const kinds = Object.keys(rep.data.report.narrative ?? {});
  const narrative = Object.fromEntries(kinds.map((k) => [k, `${P(`narrative-${k}`)}\n**x** [l](javascript:alert(1))`]));
  await t.patch(`/api/reports/${reportId}`, { narrative });
}

console.log(JSON.stringify({
  teacherCookie: t.cookieHeader(),
  studentCookie: s.cookieHeader(),
  activityId: A.activityId,
  classroomId: A.classroomId,
  linkToken: A.linkToken,
  sessionId,
  studentId,
  reportId,
}, null, 2));
