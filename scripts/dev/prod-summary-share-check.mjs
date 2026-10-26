// Checks «Devolución de la IA» against a deployed instance with the real model, in a throwaway
// workspace deleted at the end: with the activity sharing it, the student sees the AI summary of
// their work (quotes of their own words, next steps) a few seconds after sending it; without it,
// the student sees nothing.
//   node scripts/dev/prod-summary-share-check.mjs [https://aulasocratica.becode.com.ar]
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
  const { classroom } = (await req(teacher, "POST", "/api/classrooms", { name: "Prueba devolución", teacherName: "Prueba", grade: "6.º grado" })).data;
  async function published(title, patch) {
    const { activity } = (await req(teacher, "POST", "/api/activities", { classroomId: classroom.id, title })).data;
    const saved = await req(teacher, "PATCH", `/api/activities/${activity.id}`, {
      requireInitialAnswer: false,
      askReflection: false,
      instructions: "Explicá por qué un barco de acero puede flotar.",
      objectives: "Relacionar la flotación con el agua que desplaza un objeto.\nJustificar una idea con un ejemplo propio.",
      ...patch,
    });
    const pub = await req(teacher, "POST", `/api/activities/${activity.id}/publish`);
    if (pub.status !== 200) throw new Error(`publicar «${title}»: ${pub.status} ${JSON.stringify(pub.data)}`);
    return { saved: saved.data.activity, token: pub.data.activity.linkToken };
  }
  const answer = "Creo que flota porque con su forma desplaza mucha agua, como una pelota de plastilina que se hunde pero si la aplastás como un bote flota.";

  const shared = await published("El barco de acero", { shareSummary: true });
  ok("devolución activada en Configuración", shared.saved.shareSummary === true);
  const student = jar();
  await req(student, "POST", `/api/s/${shared.token}/join`, { name: "Alumno Verificación" });
  await req(student, "POST", `/api/s/${shared.token}/chat`, { text: "Pienso que es por la forma, porque una bola de acero se hunde." });
  const fin = await req(student, "POST", `/api/s/${shared.token}/finish`, { finalAnswer: answer });
  ok("alumno envía y la devolución queda en preparación", fin.status === 200 && fin.data.workspace?.feedback?.status === "pending", JSON.stringify(fin.data.workspace?.feedback));
  const started = Date.now();
  let feedback = null;
  while (Date.now() - started < 120_000) {
    feedback = (await req(student, "GET", `/api/s/${shared.token}`)).data.workspace?.feedback;
    if (feedback?.status === "ready") break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  const quotes = [...(feedback?.criteria ?? []), ...(feedback?.objectives ?? [])].flatMap((p) => p.evidence);
  ok("el alumno ve el resumen de la IA", feedback?.status === "ready" && Boolean(feedback.overview), `${Math.round((Date.now() - started) / 1000)} s · ${(feedback?.overview ?? "").slice(0, 160)}`);
  ok("con citas de lo que escribió y próximos pasos", quotes.length > 0 && feedback.nextSteps.length > 0, `${quotes.length} citas · ${feedback?.nextSteps?.length ?? 0} pasos`);
  ok("sin las notas internas de la docente", feedback && !("droppedQuotes" in feedback) && !("meta" in feedback));

  const hidden = await published("Sin devolución", {});
  const other = jar();
  await req(other, "POST", `/api/s/${hidden.token}/join`, { name: "Alumno Sin Devolución" });
  const plain = await req(other, "POST", `/api/s/${hidden.token}/finish`, { finalAnswer: answer });
  ok("sin la opción, el alumno no ve nada", plain.status === 200 && plain.data.workspace?.feedback === null);
} catch (e) {
  failed++;
  console.log(`FAIL ${e.message}`);
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200 || del.status === 204, String(del.status));
}
console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
process.exit(failed ? 1 : 0);
