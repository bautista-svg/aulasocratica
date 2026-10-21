// Exercises EVERY AI feature against a deployed instance with the real model, using a
// throwaway workspace that is deleted at the end. Usage:
//   node scripts/dev/prod-ai-full.mjs https://aulasocratica.becode.com.ar
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
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
async function req(j, method, path, body, form) {
  const headers = { origin: BASE, "x-aula-client": "1", cookie: j.header() };
  if (!form) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
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
async function sse(j, path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie: j.header() },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const done = raw.split("\n\n").find((b) => b.startsWith("event: done"));
  const err = raw.split("\n\n").find((b) => b.startsWith("event: error"));
  return { status: res.status, text: done ? JSON.parse(done.split("data: ")[1]).text : null, error: err ?? null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textImage() {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
  await page.setContent(`<body style="margin:40px;font:28px Georgia;background:#fff;color:#111">
    <h2>El ciclo del agua</h2><p>El agua se evapora con el calor del sol, se condensa formando nubes y vuelve a caer como lluvia.
    A este proceso continuo se lo llama ciclo hidrológico.</p></body>`);
  const png = await page.screenshot({ type: "png" });
  await browser.close();
  return png;
}

const teacher = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const ai = (await req(teacher, "GET", "/api/health/ai")).data.ai;
  ok("estado de la IA", ai === "ok", ai);
  const room = (await req(teacher, "POST", "/api/classrooms", { name: "Verificación IA (se borra)", subject: "Ciencias Naturales", grade: "5.º" })).data.classroom;

  // Library: a text and a photo with text (vision OCR).
  const txt = await req(teacher, "POST", "/api/materials", {
    kind: "text",
    title: "Ciclo del agua (apunte)",
    body: "El ciclo del agua tiene cuatro etapas: evaporación, condensación, precipitación y escurrimiento. La energía del Sol impulsa la evaporación de mares, ríos y lagos.",
  });
  const form = new FormData();
  form.append("file", new Blob([await textImage()], { type: "image/png" }), "pizarron.png");
  const img = await req(teacher, "POST", "/api/materials/files", undefined, form);
  const imgId = img.data.materials?.[0]?.id;
  let imgText = "";
  for (let i = 0; i < 40 && imgId; i++) {
    const m = await req(teacher, "GET", `/api/materials/${imgId}/text?offset=0&limit=2000`);
    if (m.status === 200 && m.data.text) {
      imgText = m.data.text;
      break;
    }
    await sleep(1500);
  }
  ok("lectura de foto con IA (visión)", /evapora|ciclo/i.test(imgText), imgText.slice(0, 90).replace(/\s+/g, " "));

  // Crear con IA.
  const prop = await req(teacher, "POST", "/api/planning/proposals", {
    classroomId: room.id,
    subject: "Ciencias Naturales",
    grade: "5.º grado",
    topic: "El ciclo del agua",
    durationMinutes: 40,
    skills: ["Comprender", "Aplicar"],
    materialIds: [txt.data.material?.id ?? txt.data.id, imgId].filter(Boolean),
  });
  ok("Crear con IA: propuestas", prop.status === 200 && prop.data.proposals?.length >= 1, `${prop.status} ${prop.data.proposals?.length ?? JSON.stringify(prop.data).slice(0, 160)} propuestas; ${prop.data.proposals?.[0]?.title ?? ""}`);
  const created = await req(teacher, "POST", "/api/planning/create", {
    classroomId: room.id,
    proposal: prop.data.proposals[0],
    materialIds: [],
    publish: true,
  });
  ok("Crear con IA: crear y publicar", created.status === 201, `${created.status} ${created.data.status}`);
  const actId = created.data.activityId;

  // Activity AI helpers.
  const rub = await req(teacher, "POST", `/api/activities/${actId}/ai/rubric`, { count: 3 });
  ok("rúbrica propuesta por IA", rub.status === 200 && rub.data.criteria?.length > 0, `${rub.status} ${rub.data.criteria?.map((c) => c.name).join(" | ") ?? JSON.stringify(rub.data).slice(0, 120)}`);
  if (rub.data.criteria?.length) await req(teacher, "PATCH", `/api/activities/${actId}`, { rubric: rub.data.criteria });
  const refl = await req(teacher, "POST", `/api/activities/${actId}/ai/reflection`, { count: 2 });
  ok("reflexión propuesta por IA", refl.status === 200 && refl.data.questions?.length > 0, refl.data.questions?.map((q) => q.question).join(" | "));
  const rf = new FormData();
  rf.append("file", new Blob(["Criterio: Explicación del ciclo. Niveles: En inicio (menciona una etapa), Logrado (explica las cuatro etapas y su orden).\nCriterio: Uso de vocabulario. Niveles: En inicio (sin términos científicos), Logrado (usa evaporación, condensación, precipitación)."], { type: "text/plain" }), "rubrica.txt");
  const imp = await req(teacher, "POST", `/api/activities/${actId}/rubric/import`, undefined, rf);
  ok("importar rúbrica desde archivo", imp.status === 200 && imp.data.criteria?.length >= 2, `${imp.status} ${imp.data.criteria?.map((c) => c.name).join(" | ") ?? JSON.stringify(imp.data).slice(0, 120)}`);

  // Student journey with the real tutor.
  const detail = (await req(teacher, "GET", `/api/activities/${actId}`)).data.activity;
  const student = jar();
  const join = await req(student, "POST", `/api/s/${detail.linkToken}/join`, { name: "Alumna Verificación" });
  ok("alumno entra", join.status === 201, String(join.status));
  if (detail.requireInitialAnswer) await req(student, "POST", `/api/s/${detail.linkToken}/initial`, { answer: "Creo que el agua de la lluvia viene de las nubes y las nubes aparecen solas en el cielo." });
  const c1 = await sse(student, `/api/s/${detail.linkToken}/chat`, { text: "¿Las nubes de dónde salen?" });
  ok("tutor responde (1)", c1.status === 200 && !!c1.text, (c1.text ?? c1.error ?? "").slice(0, 160));
  const c2 = await sse(student, `/api/s/${detail.linkToken}/chat`, { text: "esto es una porquería, no entiendo nada y me aburre" });
  ok("tutor responde (2, tono)", c2.status === 200 && !!c2.text, (c2.text ?? c2.error ?? "").slice(0, 160));
  await req(student, "POST", `/api/s/${detail.linkToken}/closing`);
  const fin = await req(student, "POST", `/api/s/${detail.linkToken}/finish`, {
    finalAnswer: "El sol calienta el agua y se evapora; el vapor se condensa y forma nubes; después llueve y el agua vuelve a los ríos.",
    reflection: (detail.reflectionQuestions ?? []).map((q) => ({ key: q.key, answer: "Que las nubes se forman por condensación del vapor." })),
  });
  ok("alumno termina", fin.status === 200, String(fin.status));

  await sleep(6000);
  const live = (await req(teacher, "GET", `/api/live/${actId}`)).data;
  ok("detección de alertas con IA", (live.alerts ?? []).length > 0, (live.alerts ?? []).map((a) => `${a.name}: «${a.evidence}»`).join(" | ").slice(0, 200));
  const sessionId = live.participants?.[0]?.sessionId;

  const sug = await req(teacher, "POST", `/api/sessions/${sessionId}/rubric/suggest`);
  ok("evaluación con rúbrica sugerida por IA", sug.status === 200, `${sug.status} ${JSON.stringify(sug.data.rubric?.aiSuggestion ?? sug.data).slice(0, 160)}`);
  const sum = await req(teacher, "POST", `/api/sessions/${sessionId}/summary`, { basis: ["rubric", "objectives"] });
  ok("resumen del trabajo con IA", sum.status === 200, `${sum.status} ${(sum.data.summary?.content?.overview ?? JSON.stringify(sum.data)).slice(0, 160)}`);
  const xr = await req(teacher, "POST", `/api/sessions/${sessionId}/xray/analyze`);
  ok("radiografía del pensamiento con IA", xr.status === 200, `${xr.status} ${xr.data.added ?? ""} ítems, ${xr.data.droppedQuotes ?? 0} citas descartadas`);

  const rep = await req(teacher, "POST", "/api/reports", { kind: "group", scope: { activityId: actId } });
  const narr = await req(teacher, "POST", `/api/reports/${rep.data.report?.id}/ai`);
  ok("informe: texto propuesto por IA", narr.status === 200, `${narr.status} ${JSON.stringify(narr.data.draft ?? narr.data).slice(0, 160)}`);
} catch (e) {
  ok("ejecución", false, String(e));
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  console.log(`limpieza: ${del.status}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} verificaciones OK`);
}
