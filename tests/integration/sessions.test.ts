import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db, schema } from "@server/db/client";
import { app, call, newClassroom, newTeacher } from "./helpers";
import { aiMock, recorded } from "./ai-mock";
import { insertActivity, insertAlert, insertEvents, insertFullWork, insertMessages, insertSession, insertStudent } from "./live-fixtures";

async function setup(over: Parameters<typeof insertActivity>[2] = {}) {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie, "4.º A");
  const activity = await insertActivity(t.id, classroomId, over);
  const student = await insertStudent(classroomId, "Ana Gómez");
  return { t, classroomId, activity, student };
}

async function pdfText(path: string, cookie: string) {
  const res = await app.request(path, { headers: { cookie } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  const doc = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { res, head, text: text as string, totalPages };
}

describe("session detail", () => {
  it("returns the whole work, including the partial tutor reply, without calling the AI", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    await insertMessages(session.id, [{ role: "assistant", content: "Estoy pens", isPartial: true, at: new Date() }]);
    await insertAlert(session);
    const r = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.student.fullName).toBe("Ana Gómez");
    expect(r.body.classroom.name).toBe("4.º A");
    expect(r.body.activity).toMatchObject({ title: "La fotosíntesis", requireInitialAnswer: true });
    expect(r.body.messages).toHaveLength(6);
    expect(r.body.messages.at(-1)).toMatchObject({ isPartial: true, role: "assistant" });
    expect(r.body.session.reflection[0].answer).toBe("Que la clorofila absorbe la luz del sol.");
    expect(r.body.flow.tutorQuestions).toEqual([
      "¿Qué pasaría con una planta que vive en un placard oscuro?",
      "¿Qué pigmento verde conocés?",
    ]);
    expect(r.body.flow.reformulations).toHaveLength(1);
    expect(r.body.signals.pasted.count).toBe(1);
    expect(r.body.signals.summary[0]).toContain("140 caracteres");
    expect(r.body.alerts).toHaveLength(1);
    expect(r.body.rubric.status).toBe("none");
    expect(r.body.summary).toBeNull();
    // Opening the page never triggers an AI call (the original suggested the rubric on load).
    expect(recorded).toHaveLength(0);
  });

  it("ends a work and lets the student continue it again", async () => {
    const { t, activity, student } = await setup();
    const session = await insertSession(activity.id, student.id, { initialAnswer: "Idea" });
    const end = await call("POST", `/api/sessions/${session.id}/end`, { cookie: t.cookie });
    expect(end.body).toEqual({ ok: true, changed: true });
    let [row] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, session.id));
    expect(row).toMatchObject({ status: "completed", endedByTeacher: true });
    expect(row!.completedAt).toBeTruthy();
    expect((await call("POST", `/api/sessions/${session.id}/end`, { cookie: t.cookie })).body.changed).toBe(false);

    const reopen = await call("POST", `/api/sessions/${session.id}/reopen`, { cookie: t.cookie });
    expect(reopen.body).toEqual({ ok: true, changed: true });
    [row] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, session.id));
    expect(row).toMatchObject({ status: "in_progress", endedByTeacher: false, completedAt: null });
    const detail = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(detail.body.session.status).toBe("in_progress");
  });

  it("deletes a student's work only with confirmation", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    expect((await call("DELETE", `/api/sessions/${session.id}`, { cookie: t.cookie, body: {} })).status).toBe(400);
    const r = await call("DELETE", `/api/sessions/${session.id}`, { cookie: t.cookie, body: { confirm: true } });
    expect(r.status).toBe(200);
    expect(r.body.activityId).toBe(activity.id);
    expect((await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie })).status).toBe(404);
    expect(await db.select().from(schema.messages).where(eq(schema.messages.sessionId, session.id))).toHaveLength(0);
    // The student stays in the classroom roster.
    expect(await db.select().from(schema.students).where(eq(schema.students.id, student.id))).toHaveLength(1);
  });

  it("isolates workspaces: another teacher gets 404 on every session endpoint", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const o = (await newTeacher()).cookie;
    const id = session.id;
    const checks: [string, string, unknown?][] = [
      ["GET", `/api/sessions/${id}`],
      ["POST", `/api/sessions/${id}/end`],
      ["POST", `/api/sessions/${id}/reopen`],
      ["DELETE", `/api/sessions/${id}`, { confirm: true }],
      ["GET", `/api/sessions/${id}/journey.pdf`],
      ["POST", `/api/sessions/${id}/rubric/suggest`],
      ["PUT", `/api/sessions/${id}/rubric`, { levels: {}, comment: "", confirm: false }],
      ["POST", `/api/sessions/${id}/summary`, { basis: ["objectives"] }],
      ["POST", `/api/sessions/${id}/xray/analyze`],
      ["PATCH", `/api/sessions/${id}/xray/items/abc`, { status: "validated" }],
      ["GET", `/api/students/${student.id}`],
    ];
    for (const [method, path, body] of checks) {
      const r = await call(method, path, { cookie: o, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    const list = await call("GET", "/api/sessions?view=radiografia", { cookie: o });
    expect(list.body.items).toHaveLength(0);
    expect(recorded).toHaveLength(0);
    expect(await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, id))).toHaveLength(1);
  });
});

describe("journey PDF", () => {
  it("is a real PDF with the whole journey, including the initial answer", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const { res, head, text, totalPages } = await pdfText(`/api/sessions/${session.id}/journey.pdf`, t.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("Recorrido - Ana Gomez - La fotosintesis.pdf");
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''Recorrido%20-%20Ana%20G%C3%B3mez");
    expect(head).toBe("%PDF-");
    expect(totalPages).toBeGreaterThanOrEqual(1);
    expect(text).toContain("Ana Gómez");
    expect(text).toContain("Explicá por qué las plantas necesitan luz.");
    expect(text).toContain("RESPUESTA INICIAL");
    expect(text).toContain("Creo que las plantas usan la luz para fabricar su alimento.");
    expect(text).toContain("¿Qué pasaría con una planta que vive en un placard oscuro?");
    expect(text).toContain("Solicitó una pista");
    expect(text).toContain("la clorofila atrapa la luz como un panel solar");
    expect(text).toContain("RESPUESTA FINAL");
    expect(text).toContain("Que la clorofila absorbe la luz del sol.");
    expect(text).toContain("Pegó un texto de 140 caracteres");
    expect(text).toMatch(/Página 1 de \d/);
    expect(text).not.toMatch(/error|exception|undefined|\[object Object\]/i);
  });

  it("omits the initial answer block when the activity does not ask for one", async () => {
    const { t, activity, student } = await setup({ requireInitialAnswer: false });
    const session = await insertSession(activity.id, student.id, { startedAt: new Date(Date.now() - 60_000) });
    await insertMessages(session.id, [
      { role: "assistant", content: "Hola. ¿Qué sabés de las plantas?" },
      { role: "user", content: "Que son verdes y necesitan agua." },
    ]);
    const { res, head, text } = await pdfText(`/api/sessions/${session.id}/journey.pdf`, t.cookie);
    expect(res.status).toBe(200);
    expect(head).toBe("%PDF-");
    expect(text).not.toContain("RESPUESTA INICIAL");
    expect(text).toContain("Que son verdes y necesitan agua.");
    expect(text).toContain("Todavía no la escribió.");
    expect(text).not.toMatch(/error|exception|undefined|\[object Object\]/i);
  });

  it("includes the confirmed rubric levels and validated x-ray items", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 2, evid: 1 }, comment: "Muy buen trabajo.", confirm: true } });
    await db.insert(schema.thinkingAnalyses).values({
      sessionId: session.id,
      items: [
        { id: "v1", moment: "before", category: "hypothesis", interpretation: "Parte de una hipótesis sobre la luz.", evidence: "usan la luz para fabricar su alimento", status: "validated", edited: false },
        { id: "s1", moment: "during", category: "argument_added", interpretation: "Sugerencia sin revisar.", evidence: "no puede hacer la fotosíntesis", status: "suggested", edited: false },
      ],
    });
    const { text } = await pdfText(`/api/sessions/${session.id}/journey.pdf`, t.cookie);
    expect(text).toContain("EVALUACIÓN CON RÚBRICA");
    expect(text).toContain("Argumentación");
    expect(text).toContain("Logrado");
    expect(text).toContain("Muy buen trabajo.");
    expect(text).toContain("Parte de una hipótesis sobre la luz.");
    expect(text).not.toContain("Sugerencia sin revisar.");
  });
});

describe("rubric assessment", () => {
  it("stores the AI suggestion, drops quotes the student did not write and keeps the teacher's levels", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    // The teacher already chose a level for the first criterion.
    await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 0 }, comment: "", confirm: false } });
    aiMock.json({
      criteria: [
        { criterionIndex: 0, sufficientEvidence: true, levelIndex: 2, evidence: "la clorofila atrapa la luz como un panel solar", rationale: "Da varias razones." },
        { criterionIndex: 1, sufficientEvidence: true, levelIndex: 1, evidence: "según el texto la fotosíntesis ocurre de noche", rationale: "Usa datos." },
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/rubric/suggest`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.droppedQuotes).toBe(1);
    const [arg, evid] = r.body.rubric.suggestion;
    expect(arg).toMatchObject({ criterionId: "arg", levelIndex: 2, evidence: "la clorofila atrapa la luz como un panel solar", evidenceDropped: false });
    expect(evid).toMatchObject({ criterionId: "evid", levelIndex: 1, evidence: "", evidenceDropped: true });
    expect(r.body.rubric.teacherLevels).toEqual({ arg: 0 });
    expect(r.body.rubric.status).toBe("draft");

    const req = aiMock.lastRequest()!;
    const content = JSON.stringify(req.body.messages);
    expect(content).toContain("<<<");
    expect(content).toContain("Se pondría amarilla porque no puede hacer la fotosíntesis.");
    const [usage] = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.purpose, "rubric_assessment"));
    expect(usage).toBeTruthy();
  });

  it("never accepts the canned button texts as evidence and does not invent a level without evidence", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      criteria: [
        { criterionIndex: 0, sufficientEvidence: false, levelIndex: 0, evidence: "Necesito una pista.", rationale: "No hay razones." },
        { criterionIndex: 1, sufficientEvidence: true, levelIndex: 7, evidence: "", rationale: "x" },
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/rubric/suggest`, { cookie: t.cookie });
    expect(r.body.rubric.suggestion[0]).toMatchObject({ levelIndex: null, evidence: "", evidenceDropped: true });
    expect(r.body.rubric.suggestion[1]).toMatchObject({ levelIndex: null, evidence: "" });
  });

  it("confirms the evaluation only with a level in every criterion", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const partial = await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 1 }, confirm: true } });
    expect(partial.status).toBe(400);
    expect(partial.body.error.fields["levels.evid"]).toBeTruthy();
    const bad = await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 1, evid: 5 }, confirm: true } });
    expect(bad.status).toBe(400);
    const ok = await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 1, evid: 0 }, comment: "Bien", confirm: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.rubric).toMatchObject({ status: "confirmed", teacherLevels: { arg: 1, evid: 0 }, comment: "Bien" });
    expect(ok.body.rubric.confirmedAt).toBeTruthy();
    // A confirmed evaluation is not overwritten by a new AI suggestion.
    const again = await call("POST", `/api/sessions/${session.id}/rubric/suggest`, { cookie: t.cookie });
    expect(again.status).toBe(409);
    expect(recorded).toHaveLength(0);
    // Unconfirming keeps the levels for editing.
    const edit = await call("PUT", `/api/sessions/${session.id}/rubric`, { cookie: t.cookie, body: { levels: { arg: 2, evid: 0 }, comment: "Bien", confirm: false } });
    expect(edit.body.rubric).toMatchObject({ status: "draft", teacherLevels: { arg: 2, evid: 0 }, confirmedAt: null });
  });

  it("explains when the activity has no rubric", async () => {
    const { t, activity, student } = await setup({ rubric: [] });
    const session = await insertFullWork(activity.id, student.id);
    const r = await call("POST", `/api/sessions/${session.id}/rubric/suggest`, { cookie: t.cookie });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("no tiene rúbrica");
  });

  it("shows the AI 503 message when the AI fails", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.error(500, "api_error");
    aiMock.error(500, "api_error");
    aiMock.error(500, "api_error");
    const r = await call("POST", `/api/sessions/${session.id}/rubric/suggest`, { cookie: t.cookie });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toMatch(/IA/);
  });
});

describe("AI summary", () => {
  it("keeps only quotes that appear in what the student wrote", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      overview: "Partió de una idea sobre la luz y la fue precisando.",
      criteria: [{ title: "Argumentación", observation: "Agrega razones.", evidence: ["no puede hacer la fotosíntesis", "una frase que el alumno nunca escribió"] }],
      objectives: [{ title: "Relacionar la luz con la producción de alimento", observation: "Lo relaciona.", evidence: ["usan la luz para fabricar su alimento"] }],
      nextSteps: ["Pedirle un ejemplo propio."],
    });
    const r = await call("POST", `/api/sessions/${session.id}/summary`, { cookie: t.cookie, body: { basis: ["rubric", "objectives"] } });
    expect(r.status).toBe(200);
    expect(r.body.summary.basis).toEqual(["rubric", "objectives"]);
    expect(r.body.summary.content.criteria[0].evidence).toEqual(["no puede hacer la fotosíntesis"]);
    expect(r.body.summary.content.objectives[0].evidence).toEqual(["usan la luz para fabricar su alimento"]);
    expect(r.body.summary.droppedQuotes).toBe(1);
    expect(r.body.summary.omittedMessages).toBe(0);
    const detail = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(detail.body.summary.content.overview).toContain("Partió de una idea");
  });

  it("only uses bases the activity has", async () => {
    const { t, activity, student } = await setup({ rubric: [], objectives: "" });
    const session = await insertFullWork(activity.id, student.id);
    const r = await call("POST", `/api/sessions/${session.id}/summary`, { cookie: t.cookie, body: { basis: ["rubric", "objectives"] } });
    expect(r.status).toBe(400);
    expect((await call("POST", `/api/sessions/${session.id}/summary`, { cookie: t.cookie, body: { basis: [] } })).status).toBe(400);
    expect(recorded).toHaveLength(0);
  });
});

describe("radiografía del pensamiento", () => {
  it("keeps validated items, never brings back discarded ones and drops invented or canned quotes", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      items: [
        { moment: "before", category: "hypothesis", interpretation: "Parte de una hipótesis.", evidence: "usan la luz para fabricar su alimento" },
        { moment: "during", category: "argument_added", interpretation: "Agrega una consecuencia.", evidence: "no puede hacer la fotosíntesis" },
        { moment: "during", category: "reformulation", interpretation: "Reformula con una analogía.", evidence: "la clorofila atrapa la luz como un panel solar" },
        { moment: "after", category: "metacognition", interpretation: "Inventada.", evidence: "aprendí que las plantas comen tierra" },
        { moment: "during", category: "strategy_change", interpretation: "Pide ayuda.", evidence: "Necesito una pista" },
      ],
    });
    const first = await call("POST", `/api/sessions/${session.id}/xray/analyze`, { cookie: t.cookie });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(3);
    expect(first.body.droppedQuotes).toBe(2);
    const items = first.body.xray.items as { id: string; category: string }[];
    const hyp = items.find((i) => i.category === "hypothesis")!;
    const arg = items.find((i) => i.category === "argument_added")!;

    const v = await call("PATCH", `/api/sessions/${session.id}/xray/items/${hyp.id}`, { cookie: t.cookie, body: { status: "validated" } });
    expect(v.body.item).toMatchObject({ status: "validated", edited: false });
    const d = await call("PATCH", `/api/sessions/${session.id}/xray/items/${arg.id}`, { cookie: t.cookie, body: { status: "discarded" } });
    expect(d.body.xray.discardedCount).toBe(1);
    const e = await call("PATCH", `/api/sessions/${session.id}/xray/items/${hyp.id}`, { cookie: t.cookie, body: { interpretation: "Parte de una hipótesis sobre la luz." } });
    expect(e.body.item).toMatchObject({ edited: true, interpretation: "Parte de una hipótesis sobre la luz." });

    aiMock.json({
      items: [
        // Same as the discarded one (it must not come back).
        { moment: "during", category: "argument_added", interpretation: "Agrega una consecuencia (de nuevo).", evidence: "No puede hacer la fotosíntesis." },
        { moment: "after", category: "autonomous_explanation", interpretation: "Explica con sus palabras.", evidence: "transforman la energía de la luz en azúcares" },
      ],
    });
    const second = await call("POST", `/api/sessions/${session.id}/xray/analyze`, { cookie: t.cookie });
    expect(second.status).toBe(200);
    expect(second.body.duplicates).toBe(1);
    expect(second.body.added).toBe(1);
    const cats = (second.body.xray.items as { category: string; status: string }[]).map((i) => `${i.category}:${i.status}`).sort();
    // validated kept, unreviewed suggestion replaced, discarded not resurrected, new one added.
    expect(cats).toEqual(["autonomous_explanation:suggested", "hypothesis:validated"]);
    expect(second.body.xray.discardedCount).toBe(1);
    const stored = await db.select().from(schema.thinkingAnalyses).where(eq(schema.thinkingAnalyses.sessionId, session.id));
    expect((stored[0]!.items as { status: string }[]).filter((i) => i.status === "discarded")).toHaveLength(1);
    // The prompt reads the whole conversation (with the button text marked, never as student words).
    const content = JSON.stringify(aiMock.lastRequest()!.body.messages);
    expect(content).toContain("tocó el botón");
    expect(content).toContain("Agrega una consecuencia.");
  });

  it("reads every message of long conversations (no 100-message limit)", async () => {
    const { t, activity, student } = await setup();
    const session = await insertSession(activity.id, student.id, { initialAnswer: "Idea inicial sobre la luz" });
    const msgs = Array.from({ length: 150 }, (_, i) =>
      i % 2 === 0 ? { role: "assistant" as const, content: `Pregunta ${i}. ¿Qué pensás?` } : { role: "user" as const, content: `Respuesta número ${i} del alumno` },
    );
    await insertMessages(session.id, msgs);
    aiMock.json({ items: [{ moment: "during", category: "reformulation", interpretation: "Sigue hasta el final.", evidence: "Respuesta número 149 del alumno" }] });
    const r = await call("POST", `/api/sessions/${session.id}/xray/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.added).toBe(1);
    expect(r.body.omittedMessages).toBe(0);
    expect(JSON.stringify(aiMock.lastRequest()!.body.messages)).toContain("Respuesta número 149 del alumno");
  });

  it("refuses to analyse when the student has not written anything", async () => {
    const { t, activity, student } = await setup();
    const session = await insertSession(activity.id, student.id);
    await insertMessages(session.id, [{ role: "user", content: "Necesito una pista.", intent: "hint" }]);
    const r = await call("POST", `/api/sessions/${session.id}/xray/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });
});

describe("radiografía list", () => {
  it("lists the workspace's works, completed first, paginated and filtered", async () => {
    const { t, classroomId, activity } = await setup();
    const other = await insertActivity(t.id, classroomId, { title: "Otra actividad" });
    const ids: string[] = [];
    for (let i = 0; i < 33; i++) {
      const s = await insertStudent(classroomId, `Alumno ${String(i).padStart(2, "0")}`);
      const done = i % 3 === 0;
      const sess = await insertSession(i < 31 ? activity.id : other.id, s.id, {
        status: done ? "completed" : "in_progress",
        completedAt: done ? new Date(Date.now() - i * 60_000) : null,
        lastActivityAt: new Date(Date.now() - i * 60_000),
      });
      ids.push(sess.id);
    }
    await db.insert(schema.thinkingAnalyses).values({
      sessionId: ids[0]!,
      items: [
        { id: "a", moment: "before", category: "hypothesis", interpretation: "x", evidence: "abcdefgh", status: "validated", edited: false },
        { id: "b", moment: "before", category: "hypothesis", interpretation: "y", evidence: "abcdefghi", status: "suggested", edited: false },
      ],
    });
    const p1 = await call("GET", "/api/sessions?view=radiografia", { cookie: t.cookie });
    expect(p1.status).toBe(200);
    expect(p1.body.items).toHaveLength(30);
    expect(p1.body.nextCursor).toBeTruthy();
    const statuses = p1.body.items.map((i: { status: string }) => i.status);
    expect(statuses.slice(0, 11).every((s: string) => s === "completed")).toBe(true);
    expect(statuses.slice(11).every((s: string) => s === "in_progress")).toBe(true);
    expect(p1.body.items[0].xray).toEqual({ analyzed: true, validated: 1, suggested: 1, discarded: 0 });
    const p2 = await call("GET", `/api/sessions?view=radiografia&cursor=${encodeURIComponent(p1.body.nextCursor)}`, { cookie: t.cookie });
    expect(p2.body.items).toHaveLength(3);
    expect(p2.body.nextCursor).toBeNull();
    const all = [...p1.body.items, ...p2.body.items].map((i: { sessionId: string }) => i.sessionId);
    expect(new Set(all).size).toBe(33);

    const filtered = await call("GET", `/api/sessions?view=radiografia&activityId=${other.id}`, { cookie: t.cookie });
    expect(filtered.body.items).toHaveLength(2);
    const search = await call("GET", `/api/sessions?view=radiografia&q=alumno 05`, { cookie: t.cookie });
    expect(search.body.items.map((i: { studentName: string }) => i.studentName)).toEqual(["Alumno 05"]);
    expect((await call("GET", "/api/sessions?view=radiografia&cursor=basura", { cookie: t.cookie })).status).toBe(400);
    expect((await call("GET", "/api/sessions?view=radiografia&classroomId=nope", { cookie: t.cookie })).status).toBe(400);
  });
});
