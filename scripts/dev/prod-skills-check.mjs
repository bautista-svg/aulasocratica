// Checks the formative skills evaluation against a deployed instance with the real model, in a
// throwaway workspace deleted at the end: a 6th-grade work is evaluated (levels backed by the
// student's quotes, constructive feedback with a next step), an indicator shown is at least
// «Logrado» and an unticked one is not used, nothing is left with the former criteria, and
// «Reevaluar habilidades» finishes.
//   node scripts/dev/prod-skills-check.mjs [https://aulasocratica.becode.com.ar]
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

const UNTICKED = "Utiliza evidencias para sostener sus ideas.";
const teacher = jar();
const student = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const { settings } = (await req(teacher, "GET", "/api/skills")).data;
  const put = await req(teacher, "PUT", "/api/skills", { ...settings, off: { argumentacion: [UNTICKED] } });
  ok("indicador destildado guardado", put.status === 200 && put.data.settings.off.argumentacion?.[0] === UNTICKED);
  const { classroom } = (await req(teacher, "POST", "/api/classrooms", { name: "Prueba habilidades", teacherName: "Prueba", grade: "6.º grado" })).data;
  const { activity } = (await req(teacher, "POST", "/api/activities", { classroomId: classroom.id, title: "Misión espacial" })).data;
  await req(teacher, "PATCH", `/api/activities/${activity.id}`, {
    requireInitialAnswer: false,
    askFinalAnswer: false,
    askReflection: false,
    objectives: "Relacionar las características de un planeta con los desafíos de explorarlo y proponer soluciones.",
    material: "Marte: atmósfera delgada de dióxido de carbono (no se puede respirar), temperatura media de -60 °C, agua congelada en los polos, a 225 millones de km de la Tierra.",
    consignas: [
      { id: "elegir", title: "Comenzamos la actividad", text: "Elegí un planeta y justificá por qué conviene explorarlo.", answer: true },
      { id: "desafios", title: "Desafíos y soluciones", text: "Identificá los desafíos de la misión y proponé una solución para cada uno.", answer: true },
    ],
  });
  await req(teacher, "POST", `/api/activities/${activity.id}/publish`);
  const token = (await req(teacher, "GET", `/api/activities/${activity.id}`)).data.activity.linkToken;

  await req(student, "POST", `/api/s/${token}/join`, { name: "Alumno Verificación" });
  await req(student, "POST", `/api/s/${token}/answer`, { consignaId: "elegir", text: "elegi marte porque tiene agua congelada y esta cerca" });
  await req(student, "POST", `/api/s/${token}/chat`, { text: "hace mucho frio -60 grados, nesesitan trajes calentitos", consigna: 1 });
  await req(student, "POST", `/api/s/${token}/chat`, { text: "y no se puede respirar, hay que llevar tanques de oxigeno", consigna: 1 });
  const fin = await req(student, "POST", `/api/s/${token}/finish`, {
    consignaAnswers: { desafios: "el frio: trajes calentitos. no hay aire: tanques de oxigeno. el agua congelada: derretirla" },
    reflection: [],
  });
  ok("alumno termina", fin.status === 200);
  const sid = (await req(teacher, "GET", `/api/live/${activity.id}`)).data.participants[0].sessionId;

  const started = Date.now();
  const r = await req(teacher, "POST", `/api/sessions/${sid}/skills/analyze`);
  ok("evaluación de habilidades", r.status === 200, `${Math.round((Date.now() - started) / 1000)} s`);
  const skills = r.data.skills ?? [];
  const leveled = skills.filter((s) => s.status !== "sin_evidencia");
  ok("niveles con cita del alumno", leveled.length > 0 && leveled.every((s) => s.evidence), skills.map((s) => `${s.label}: ${s.status}`).join(" · "));
  ok("reconoce avances (algún «logrado» en un trabajo breve con avances)", skills.some((s) => s.status === "logrado" || s.status === "avanzado"));
  const sample = leveled.find((s) => s.improve) ?? leveled[0];
  ok("devolución con lo que muestra y un próximo paso", Boolean(sample?.why && sample?.improve), sample ? `${sample.why} / ${sample.improve}` : "");
  ok("sin «no demuestra» en lo que muestra", !leveled.some((s) => /no demuestra|no logra/i.test(s.why)));
  const shown = skills.filter((s) => s.criterion);
  ok("indicador mostrado ⇒ Logrado o Avanzado", shown.length > 0 && shown.every((s) => s.status === "logrado" || s.status === "avanzado"), shown.map((s) => `${s.label}: ${s.criterion}`).join(" · "));
  ok("no usa el indicador destildado", !skills.some((s) => s.criterion === UNTICKED));

  const g = await req(teacher, "GET", `/api/activities/${activity.id}/skills`);
  ok("ningún trabajo con los criterios anteriores", g.data.outdatedWorks === 0);
  ok("Fortalezas muestra solo los tildados", !g.data.skills.find((s) => s.key === "argumentacion")?.criteria.includes(UNTICKED));
  const re = await req(teacher, "POST", `/api/activities/${activity.id}/skills/reevaluate`);
  ok("reevaluar empieza", re.status === 202);
  let run = re.data.run;
  for (let i = 0; i < 90 && run?.status === "running"; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    run = (await req(teacher, "GET", `/api/activities/${activity.id}/skills`)).data.run;
  }
  ok("reevaluar termina", run?.status === "done", JSON.stringify(run));
} catch (e) {
  ok("sin errores inesperados", false, String(e));
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200);
  console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
  process.exitCode = failed ? 1 : 0;
}
