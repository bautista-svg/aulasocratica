// Checks the features added on 2026-10-22 against a deployed instance with the real model, in a
// throwaway workspace deleted at the end: combined tutors, link delivery, skills with levels and
// real quotes (per work and per group), the calibrated rubric suggestion and full objectives in the
// summary.
//   node scripts/dev/prod-ai-new.mjs https://aulasocratica.becode.com.ar
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
async function sse(j, path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie: j.header() },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const done = raw.split("\n\n").find((b) => b.startsWith("event: done"));
  return { status: res.status, text: done ? JSON.parse(done.split("data: ")[1]).text : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const teacher = jar();
const student = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const room = (await req(teacher, "POST", "/api/classrooms", { name: "Verificación (se borra)", grade: "1.º año", division: "A" })).data.classroom;
  const act = (await req(teacher, "POST", "/api/activities", { classroomId: room.id, title: "Esparta y Atenas" })).data.activity;
  const patch = await req(teacher, "PATCH", `/api/activities/${act.id}`, {
    instructions: "Compará cómo se gobernaba Esparta y cómo se gobernaba Atenas. ¿En cuál te hubiera gustado vivir y por qué?",
    objectives: "Comparar las formas de gobierno de Esparta y Atenas.\nJustificar una opinión con datos del texto.",
    material:
      "Esparta era una ciudad-estado del Peloponeso centrada en el ejército. La gobernaban dos reyes, cinco supervisores elegidos y un Consejo de Ancianos de 30 ciudadanos; la Asamblea votaba las leyes. Los ilotas eran esclavos que trabajaban la tierra. En Atenas, en cambio, los ciudadanos varones participaban directamente en la Asamblea: fue la primera democracia.",
    requireInitialAnswer: false,
    askReflection: false,
    tutorType: "comprension_lectora",
    extraTutorTypes: ["pensamiento_critico", "debate_socratico"],
    rubric: [
      {
        name: "Comparación",
        description: "Compara los gobiernos de las dos ciudades.",
        levels: [
          { label: "En inicio", description: "Describe una sola ciudad." },
          { label: "En proceso", description: "Menciona diferencias sueltas." },
          { label: "Logrado", description: "Compara con al menos dos diferencias claras." },
        ],
      },
    ],
  });
  ok("tutores combinados guardados", patch.status === 200 && patch.data.activity.extraTutorTypes?.length === 2, (patch.data.activity?.extraTutorTypes ?? []).join(", "));
  await req(teacher, "POST", `/api/activities/${act.id}/publish`);
  const token = (await req(teacher, "GET", `/api/activities/${act.id}`)).data.activity.linkToken;

  await req(student, "POST", `/api/s/${token}/join`, { name: "Alumno Verificación" });
  const c1 = await sse(student, `/api/s/${token}/chat`, { text: "Yo creo que en Esparta mandaba un rey solo y nadie más." });
  ok("tutor combinado responde con una pregunta", c1.status === 200 && /\?/.test(c1.text ?? ""), (c1.text ?? "").slice(0, 220));
  const c2 = await sse(student, `/api/s/${token}/chat`, { text: "Ah, eran dos reyes y un consejo. En Atenas votaban los ciudadanos, por eso prefiero Atenas." });
  ok("tutor responde (2)", c2.status === 200 && !!c2.text, (c2.text ?? "").slice(0, 220));

  const link = await req(student, "POST", `/api/s/${token}/deliverable/link`, { url: "www.canva.com/design/DAF123/view" });
  ok("entrega con enlace", link.status === 201 && link.data.workspace?.deliverable?.kind === "link", link.data.workspace?.deliverable?.name);
  await req(student, "POST", `/api/s/${token}/closing`);
  const fin = await req(student, "POST", `/api/s/${token}/finish`, {
    finalAnswer: "Esparta tenía dos reyes, un consejo de 30 ancianos y una asamblea; Atenas era una democracia donde votaban los ciudadanos. Prefiero Atenas porque la gente participaba.",
    reflection: [],
  });
  ok("alumno termina", fin.status === 200, String(fin.status));

  await sleep(3000);
  const sessionId = (await req(teacher, "GET", `/api/live/${act.id}`)).data.participants?.[0]?.sessionId;
  const sk = await req(teacher, "POST", `/api/sessions/${sessionId}/skills/analyze`);
  const skills = sk.data.skills ?? [];
  const leveled = skills.filter((s) => s.status !== "sin_evidencia");
  ok(
    "habilidades con niveles y citas reales (IA real)",
    sk.status === 200 && skills.length >= 8 && leveled.length > 0 && leveled.every((s) => s.evidence && s.criterion),
    skills.map((s) => `${s.skill}: ${s.status}${s.evidence ? ` «${s.evidence.slice(0, 50)}»` : ""}`).join(" | ").slice(0, 600),
  );
  console.log(`     por qué (${leveled[0]?.skill}): ${leveled[0]?.why}
     mejorar: ${leveled[0]?.improve}
     sugerencia: ${leveled[0]?.suggestion}
     recomendaciones: ${(sk.data.recommendations ?? []).join(" | ")}
     citas quitadas: ${sk.data.droppedQuotes}`);
  const group = await req(teacher, "GET", `/api/activities/${act.id}/skills`);
  ok("vista del grupo", group.status === 200 && group.data.assessedWorks === 1, `${group.data.skills?.length ?? 0} habilidades · ${group.data.interventions} intervenciones`);
  const sug = await req(teacher, "POST", `/api/sessions/${sessionId}/rubric/suggest`);
  ok("sugerencia de rúbrica calibrada", sug.status === 200, (sug.data.rubric?.suggestion ?? []).map((s) => `nivel ${s.levelIndex}: ${s.rationale}`).join(" | ").slice(0, 300));
  const sum = await req(teacher, "POST", `/api/sessions/${sessionId}/summary`, { basis: ["rubric", "objectives"] });
  ok("resumen con objetivos completos", sum.status === 200 && (sum.data.summary?.content?.objectives ?? []).some((o) => o.title.includes("Justificar una opinión con datos del texto")), String(sum.status));
} catch (e) {
  ok("sin errores inesperados", false, String(e));
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200, String(del.status));
  console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
  process.exit(failed ? 1 : 0);
}
