// End-to-end AI check against a deployed instance (creates a throwaway workspace and deletes it).
// Usage: node scripts/dev/prod-ai-check.mjs https://aulasocratica.becode.com.ar
const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";

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
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const teacher = jar();
const t0 = Date.now();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  console.log("health/ai:", (await req(teacher, "GET", "/api/health/ai")).data);
  const room = (await req(teacher, "POST", "/api/classrooms", { name: "Prueba IA (se borra sola)" })).data.classroom;
  const act = (await req(teacher, "POST", "/api/activities", { classroomId: room.id, title: "¿Por qué flotan los barcos?" })).data.activity;
  await req(teacher, "PATCH", `/api/activities/${act.id}`, {
    instructions: "Explicá con tus palabras por qué un barco de acero puede flotar en el agua.",
    objectives: "Relacionar la flotación con el agua que desplaza un objeto.",
    requireInitialAnswer: false,
  });
  const pub = await req(teacher, "POST", `/api/activities/${act.id}/publish`);
  console.log("publish:", pub.status);

  const refl = await req(teacher, "POST", `/api/activities/${act.id}/ai/reflection`, { count: 2 });
  console.log("AI reflection proposal:", refl.status, JSON.stringify(refl.data).slice(0, 300));

  const token = (await req(teacher, "GET", `/api/activities/${act.id}`)).data.activity.linkToken;
  const student = jar();
  const join = await req(student, "POST", `/api/s/${token}/join`, { name: "Alumna De Prueba" });
  console.log("student join:", join.status);
  const t1 = Date.now();
  const chat = await fetch(`${BASE}/api/s/${token}/chat`, {
    method: "POST",
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie: student.header() },
    body: JSON.stringify({ text: "Creo que flota porque el acero es liviano. ¿Es así?" }),
  });
  const reader = chat.body.getReader();
  const dec = new TextDecoder();
  let raw = "";
  let firstDeltaMs = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    if (firstDeltaMs === null && raw.includes("event: delta")) firstDeltaMs = Date.now() - t1;
  }
  const doneEvt = raw.split("\n\n").find((b) => b.startsWith("event: done"));
  const errEvt = raw.split("\n\n").find((b) => b.startsWith("event: error"));
  console.log("tutor chat HTTP:", chat.status, "first token ms:", firstDeltaMs, "total ms:", Date.now() - t1);
  if (doneEvt) console.log("tutor reply:", JSON.parse(doneEvt.split("data: ")[1]).text);
  if (errEvt) console.log("tutor error:", errEvt);
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  console.log("cleanup:", del.status, `(${Date.now() - t0} ms)`);
}
