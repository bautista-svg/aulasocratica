// Checks the activity structure against a deployed instance with the real model, in a throwaway
// workspace deleted at the end: consignas with titles and written answers, the presentation, the
// answer saved while typing, the tutor knowing which consigna the student is on, and finishing.
//   node scripts/dev/prod-structure-check.mjs [https://aulasocratica.becode.com.ar]
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
async function chat(j, token, body) {
  const r = await req(j, "POST", `/api/s/${token}/chat`, body);
  const done = typeof r.data === "string" ? r.data.split("\n\n").find((b) => b.startsWith("event: done")) : null;
  return { status: r.status, text: done ? JSON.parse(done.split("data: ")[1]).text : "" };
}

const teacher = jar();
const student = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const { classroom } = (await req(teacher, "POST", "/api/classrooms", { name: "Prueba estructura", teacherName: "Prueba" })).data;
  const { activity } = (await req(teacher, "POST", "/api/activities", { classroomId: classroom.id, title: "Misión espacial" })).data;
  const saved = await req(teacher, "PATCH", `/api/activities/${activity.id}`, {
    requireInitialAnswer: false,
    askFinalAnswer: false,
    askReflection: false,
    presentationOn: true,
    presentation: "¡La agencia espacial necesita tu ayuda! Vas a diseñar una misión a un planeta del Sistema Solar.",
    material: "Marte: planeta rocoso, atmósfera delgada de dióxido de carbono, temperatura media de -60 °C, agua congelada en los polos, a 225 millones de km de la Tierra en promedio.",
    consignas: [
      { id: "elegir", title: "Comenzamos la actividad", text: "Elegí un planeta y justificá por qué conviene explorarlo.", answer: true },
      { id: "desafios", title: "Desafíos y soluciones", text: "Identificá dos desafíos de la misión y proponé una solución para cada uno.", answer: true },
    ],
  });
  ok("estructura guardada", saved.status === 200 && saved.data.activity.consignas.length === 2, saved.data.activity?.consignas?.map((c) => c.title).join(" · "));
  await req(teacher, "POST", `/api/activities/${activity.id}/publish`);
  const token = (await req(teacher, "GET", `/api/activities/${activity.id}`)).data.activity.linkToken;

  const joined = await req(student, "POST", `/api/s/${token}/join`, { name: "Alumno Verificación" });
  const ws = joined.data.workspace;
  ok("presentación y consignas para el alumno", Boolean(ws?.activity.presentation) && ws.activity.consignas[1].title === "Desafíos y soluciones");
  ok("respuesta de la consigna 1 guardada", (await req(student, "POST", `/api/s/${token}/answer`, { consignaId: "elegir", text: "Marte, porque tiene agua congelada." })).status === 200);
  const c1 = await chat(student, token, { text: "Ya elegí Marte, ¿está bien mi razón?", consigna: 0 });
  ok("tutor en la consigna 1 (pregunta, no responde por él)", c1.status === 200 && /\?/.test(c1.text), c1.text.slice(0, 220));
  const c2 = await chat(student, token, { text: "Pasé a la siguiente. No sé qué desafíos hay.", consigna: 1 });
  ok("tutor acompaña la consigna 2", c2.status === 200 && /\?/.test(c2.text), c2.text.slice(0, 220));
  const missing = await req(student, "POST", `/api/s/${token}/finish`, { reflection: [] });
  ok("no deja enviar sin la respuesta de la consigna 2", missing.status === 400 && Boolean(missing.data.error?.fields?.["consigna.desafios"]));
  const fin = await req(student, "POST", `/api/s/${token}/finish`, {
    consignaAnswers: { desafios: "El frío extremo: trajes térmicos. La distancia: llevar provisiones para dos años." },
    reflection: [],
  });
  ok("alumno termina", fin.status === 200, (fin.data.workspace?.session.finalAnswer ?? "").replace(/\n/g, " / ").slice(0, 220));
} catch (e) {
  ok("sin errores inesperados", false, String(e));
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200);
  console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
  process.exitCode = failed ? 1 : 0;
}
