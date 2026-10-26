// Checks the required final reflection against a deployed instance, in a throwaway workspace
// deleted at the end: the work is not sent while a reflection question is blank (each blank one
// is pointed out), it is sent once every question has an answer, and an activity without a
// reflection still finishes without one.
//   node scripts/dev/prod-reflection-check.mjs [https://aulasocratica.becode.com.ar]
const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
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
async function req(j, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie: j.header() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  j.store(res);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

const teacher = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const { classroom } = (await req(teacher, "POST", "/api/classrooms", { name: "Prueba reflexión", teacherName: "Prueba" })).data;
  async function published(title, patch) {
    const { activity } = (await req(teacher, "POST", "/api/activities", { classroomId: classroom.id, title })).data;
    await req(teacher, "PATCH", `/api/activities/${activity.id}`, { requireInitialAnswer: false, askFinalAnswer: false, instructions: "Compare Sparta and Athens.", ...patch });
    const pub = await req(teacher, "POST", `/api/activities/${activity.id}/publish`);
    if (pub.status !== 200) throw new Error(`publicar «${title}»: ${pub.status} ${JSON.stringify(pub.data)}`);
    return (await req(teacher, "GET", `/api/activities/${activity.id}`)).data.activity.linkToken;
  }

  const token = await published("Thinking About My Thinking", {
    language: "en",
    reflectionQuestions: [
      { key: "before", question: "About the way I studied and understood this topic, I used to think…" },
      { key: "tutor", question: "After talking to the tutor, I realize that…" },
    ],
  });
  const student = jar();
  const joined = await req(student, "POST", `/api/s/${token}/join`, { name: "Alumno Verificación" });
  const questions = joined.data.workspace?.activity.reflectionQuestions ?? [];
  ok("el alumno recibe las preguntas de la reflexión", questions.length === 2, questions.map((q) => q.question).join(" · "));
  const finish = (answers) => req(student, "POST", `/api/s/${token}/finish`, { reflection: questions.map((q, i) => ({ key: q.key, answer: answers[i] ?? "" })) });
  const none = await finish([]);
  ok("no deja enviar sin responder la reflexión", none.status === 400 && Object.keys(none.data.error?.fields ?? {}).length === 2, none.data.error?.message);
  const one = await finish(["I used to read it once and that was it."]);
  ok("marca la pregunta que falta", one.status === 400 && Object.keys(one.data.error?.fields ?? {}).join() === "reflection.1.answer", JSON.stringify(one.data.error?.fields));
  const done = await finish(["I used to read it once and that was it.", "I have to compare both cities with data."]);
  ok("envía con todas respondidas", done.status === 200 && done.data.workspace?.session.status === "completed" && done.data.workspace.session.reflection.every((r) => r.answer));

  const off = await published("Sin reflexión", { askReflection: false });
  const other = jar();
  await req(other, "POST", `/api/s/${off}/join`, { name: "Alumno Sin Reflexión" });
  const plain = await req(other, "POST", `/api/s/${off}/finish`, { reflection: [] });
  ok("sin reflexión se envía igual", plain.status === 200, String(plain.status));
} catch (e) {
  failed++;
  console.log(`FAIL ${e.message}`);
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200 || del.status === 204, String(del.status));
}
console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
process.exit(failed ? 1 : 0);
