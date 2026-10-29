// Checks «Cuándo deja de preguntar» against a deployed instance with the real model, in a
// throwaway workspace deleted at the end: (1) a limit of 4 tutor messages, where the 4th closes
// without a question and a 5th message is refused; (2) «terminar antes si ya logró los
// objetivos», where a student who explains well gets a closing before the limit.
//   node scripts/dev/prod-closing-check.mjs [https://aulasocratica.becode.com.ar]
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
  const block = raw.split("\n\n").find((b) => b.startsWith("event: done"));
  const done = block ? JSON.parse(block.split("data: ")[1]) : null;
  const shown = raw
    .split("\n\n")
    .filter((b) => b.startsWith("event: delta"))
    .map((b) => JSON.parse(b.split("data: ")[1]).text)
    .join("");
  return { status: res.status, text: done?.text ?? null, tutorDone: done?.tutorDone ?? null, shown, raw };
}
const say = (who, text) => console.log(`  ${who}: ${(text ?? "").replace(/\n+/g, " ")}`);

const teacher = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const room = (await req(teacher, "POST", "/api/classrooms", { name: "Matemática (se borra)", grade: "1.º año" })).data.classroom;
  async function activity(title, patch) {
    const act = (await req(teacher, "POST", "/api/activities", { classroomId: room.id, title })).data.activity;
    const r = await req(teacher, "PATCH", `/api/activities/${act.id}`, {
      instructions: "¿Es cierto que 2/4 y 1/2 representan la misma cantidad? Explicá por qué.",
      objectives: "Explicar con sus palabras por qué dos fracciones son equivalentes.",
      requireInitialAnswer: false,
      askReflection: false,
      ...patch,
    });
    if (r.status !== 200) throw new Error(`patch ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    await req(teacher, "POST", `/api/activities/${act.id}/publish`);
    return (await req(teacher, "GET", `/api/activities/${act.id}`)).data.activity.linkToken;
  }

  console.log("\n1) Máximo de 4 preguntas");
  {
    const token = await activity("Con máximo", { tutorMaxQuestions: 4 });
    const s = jar();
    await req(s, "POST", `/api/s/${token}/join`, { name: "Alumno Máximo" });
    const turns = ["Hola", "Creo que sí", "No sé bien", "Porque las dos son la mitad"];
    let last;
    for (const text of turns) {
      last = await sse(s, `/api/s/${token}/chat`, { text });
      say("ALUMNO", text);
      say("TUTOR ", last.text ?? `(sin respuesta ${last.status})`);
    }
    ok("el 4.º mensaje cierra", last.tutorDone === "limit", String(last.tutorDone));
    ok("el último no termina con una pregunta", !/\?\s*$/.test(last.text ?? ""), (last.text ?? "").slice(-120));
    ok("menciona «Terminar»", /Terminar/.test(last.text ?? ""));
    const extra = await sse(s, `/api/s/${token}/chat`, { text: "¿Y ahora?" });
    ok("un 5.º mensaje se rechaza", extra.status === 409 && extra.raw.includes("tutor_done"), String(extra.status));
  }

  console.log("\n2) Terminar antes si ya logró los objetivos");
  {
    const token = await activity("Con objetivo", { tutorStopWhenAchieved: true, tutorMaxQuestions: 10 });
    const s = jar();
    await req(s, "POST", `/api/s/${token}/join`, { name: "Alumno Objetivo" });
    const turns = [
      "Sí, son iguales.",
      "Porque si partís un entero en 4 partes iguales y tomás 2, ocupás lo mismo que si lo partís en 2 y tomás 1: la mitad.",
      "Además 2/4 se simplifica dividiendo arriba y abajo por 2 y da 1/2. Multiplicar o dividir numerador y denominador por el mismo número no cambia la cantidad, por eso 3/6 o 4/8 también son la mitad.",
      "Por ejemplo con una pizza: 4 porciones de 8 es lo mismo que 1 de 2, y en la recta numérica 2/4 y 1/2 caen en el mismo punto, el 0,5.",
      "Si multiplicara solo el numerador cambiaría: 2/2 ya es un entero. Tiene que ser el mismo número arriba y abajo.",
    ];
    let closedAt = 0;
    for (const [i, text] of turns.entries()) {
      const r = await sse(s, `/api/s/${token}/chat`, { text });
      say("ALUMNO", text);
      say("TUTOR ", r.text ?? `(sin respuesta ${r.status})`);
      ok(`turno ${i + 1}: la marca nunca se ve`, !/TERMINADO/i.test(r.shown + (r.text ?? "")));
      if (r.tutorDone === "achieved") {
        closedAt = i + 1;
        ok("al cerrar no pregunta", !/\?\s*$/.test(r.text ?? ""), (r.text ?? "").slice(-120));
        break;
      }
    }
    ok("cierra antes del máximo cuando ya lo mostró", closedAt > 0, closedAt ? `en el turno ${closedAt}` : "no cerró");
  }
} catch (e) {
  ok("sin errores inesperados", false, String(e));
} finally {
  const del = await req(teacher, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
  ok("espacio de prueba borrado", del.status === 200, String(del.status));
  console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
  process.exit(failed ? 1 : 0);
}
