import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@server/db/client";
import { publish } from "@server/lib/events";
import { app, call, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertAlert, insertEvents, insertFullWork, insertMessages, insertSession, insertStudent } from "./live-fixtures";

async function setup() {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie);
  const activity = await insertActivity(t.id, classroomId);
  return { t, classroomId, activity };
}

describe("live snapshot", () => {
  it("lists only the students who joined THIS activity (never the classroom roster)", async () => {
    const { t, classroomId, activity } = await setup();
    const other = await insertActivity(t.id, classroomId, { title: "Otra actividad" });
    const ana = await insertStudent(classroomId, "Ana Gómez");
    const beto = await insertStudent(classroomId, "Beto Ruiz");
    await insertStudent(classroomId, "Carla Solo Roster");
    await insertFullWork(activity.id, ana.id);
    await insertSession(other.id, beto.id, { initialAnswer: "Mi idea" });

    const r = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.participants.map((p: { studentName: string }) => p.studentName)).toEqual(["Ana Gómez"]);
    expect(r.body.totals.joined).toBe(1);
    expect(r.body.totals.completed).toBe(1);
    expect(r.body.heatmaps.help.rows).toHaveLength(1);
    expect(r.body.heatmaps.timeline.rows).toHaveLength(1);

    const r2 = await call("GET", `/api/live/${other.id}`, { cookie: t.cookie });
    expect(r2.body.participants.map((p: { studentName: string }) => p.studentName)).toEqual(["Beto Ruiz"]);
  });

  it("computes stage, progress and help counts from observed events", async () => {
    const { t, classroomId, activity } = await setup();
    const s = await insertStudent(classroomId, "Dani Paz");
    const session = await insertSession(activity.id, s.id, { initialAnswer: "Primera idea", startedAt: new Date(Date.now() - 10 * 60_000) });
    await insertEvents(session.id, [
      { type: "initial_answer_saved" },
      { type: "message_sent" },
      { type: "hint_requested" },
      { type: "hint_requested" },
      { type: "hint_requested" },
      { type: "left_app", details: { away_ms: 30_000 } },
    ]);
    await insertMessages(session.id, [{ role: "assistant", content: "Bien. ¿Por qué pensás eso?" }]);
    const r = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    const p = r.body.participants[0];
    expect(p.currentStage).toBe("tutor");
    expect(p.stepsTotal).toBe(3);
    expect(p.progressSteps).toBe(1);
    expect(p.helpCounts.hint_requested).toBe(3);
    expect(p.helpRequests).toBe(3);
    expect(p.supportReasons).toContain("Pidió 3 pistas");
    expect(p.needsSupport).toBe(true);
    expect(p.lastTutorQuestion).toBe("¿Por qué pensás eso?");
    expect(p.liveStatus).toBe("active");
    expect(r.body.totals.needSupport).toBe(1);
  });

  it("handles activities without initial answer: 2 steps and no 'initial' stage", async () => {
    const t = await newTeacher();
    const classroomId = await newClassroom(t.cookie);
    const activity = await insertActivity(t.id, classroomId, { requireInitialAnswer: false });
    const s1 = await insertStudent(classroomId, "Eli Sosa");
    const s2 = await insertStudent(classroomId, "Fede Luna");
    const s3 = await insertStudent(classroomId, "Gabi Mar");
    const old = new Date(Date.now() - 30 * 60_000);
    await insertSession(activity.id, s1.id, { startedAt: old });
    const closing = await insertSession(activity.id, s2.id, { startedAt: old });
    await insertEvents(closing.id, [{ type: "message_sent" }, { type: "closing_started" }]);
    await insertSession(activity.id, s3.id, { status: "completed", completedAt: new Date(), finalAnswer: "Listo" });

    const r = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    const [eli, fede, gabi] = r.body.participants;
    expect(r.body.activity.requireInitialAnswer).toBe(false);
    expect(eli.currentStage).toBe("tutor");
    expect(eli.stepsTotal).toBe(2);
    expect(eli.progressSteps).toBe(0);
    expect(eli.supportReasons).toEqual([]);
    expect(fede.currentStage).toBe("closing");
    expect(fede.progressSteps).toBe(1);
    expect(gabi.currentStage).toBe("done");
    expect(gabi.progressSteps).toBe(2);
    expect(r.body.heatmaps.stages.columns.map((c: { key: string }) => c.key)).toEqual(["tutor", "closing", "total"]);

    // Same data with the initial answer required: the student is stuck in the first stage.
    await db.update(schema.activities).set({ requireInitialAnswer: true }).where(eq(schema.activities.id, activity.id));
    const r2 = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    expect(r2.body.participants[0].currentStage).toBe("initial");
    expect(r2.body.participants[0].stepsTotal).toBe(3);
    expect(r2.body.participants[0].progressSteps).toBe(0);
    expect(r2.body.participants[0].supportReasons).toContain("Entró pero todavía no escribió su respuesta inicial");
  });

  it("returns open alerts first and lets the teacher review, dismiss and reopen them", async () => {
    const { t, classroomId, activity } = await setup();
    const s = await insertStudent(classroomId, "Hana Ito");
    const session = await insertSession(activity.id, s.id, { initialAnswer: "x" });
    const reviewed = await insertAlert(session, { status: "reviewed", reviewedAt: new Date() });
    const open = await insertAlert(session, { alertKey: "safety_signal", name: "Señal de seguridad", category: "seguridad", severity: "immediate" });
    const pasted = await insertAlert(session, { alertKey: "pasted_text", name: "Pegó texto de afuera", category: "integridad", source: "observed" });

    const r = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    expect(r.body.alerts.map((a: { id: string }) => a.id)).toEqual([open.id, pasted.id, reviewed.id]);
    expect(r.body.alerts[0]).toMatchObject({ studentName: "Hana Ito", severity: "immediate", origin: "ai", status: "open" });
    expect(r.body.alerts[1].origin).toBe("observed");
    expect(r.body.participants[0].openAlerts).toBe(2);
    expect(r.body.participants[0].immediateAlerts).toBe(1);
    expect(r.body.totals.openAlerts).toBe(2);

    const p = await call("PATCH", `/api/live/${activity.id}/alerts/${open.id}`, { cookie: t.cookie, body: { status: "reviewed" } });
    expect(p.status).toBe(200);
    expect(p.body.alert.status).toBe("reviewed");
    expect(p.body.alert.reviewedAt).toBeTruthy();
    const d = await call("PATCH", `/api/live/${activity.id}/alerts/${pasted.id}`, { cookie: t.cookie, body: { status: "dismissed" } });
    expect(d.body.alert.status).toBe("dismissed");
    const back = await call("PATCH", `/api/live/${activity.id}/alerts/${pasted.id}`, { cookie: t.cookie, body: { status: "open" } });
    expect(back.body.alert.reviewedAt).toBeNull();
    expect((await call("PATCH", `/api/live/${activity.id}/alerts/${open.id}`, { cookie: t.cookie, body: { status: "nope" } })).status).toBe(400);

    // An alert of another activity cannot be changed through this one.
    const other = await insertActivity(t.id, classroomId, { title: "Otra" });
    expect((await call("PATCH", `/api/live/${other.id}/alerts/${open.id}`, { cookie: t.cookie, body: { status: "open" } })).status).toBe(404);
  });

  it("ends every work in progress with 'Terminar para todos' (confirmation required)", async () => {
    const { t, classroomId, activity } = await setup();
    const a = await insertStudent(classroomId, "Iara Paz");
    const b = await insertStudent(classroomId, "Juan Paz");
    const c = await insertStudent(classroomId, "Kevin Paz");
    const s1 = await insertSession(activity.id, a.id);
    const s2 = await insertSession(activity.id, b.id, { initialAnswer: "algo" });
    const done = await insertFullWork(activity.id, c.id);

    expect((await call("POST", `/api/live/${activity.id}/end-all`, { cookie: t.cookie, body: {} })).status).toBe(400);
    const r = await call("POST", `/api/live/${activity.id}/end-all`, { cookie: t.cookie, body: { confirm: true } });
    expect(r.status).toBe(200);
    expect(r.body.ended).toBe(2);
    const rows = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.activityId, activity.id));
    for (const id of [s1.id, s2.id]) {
      const row = rows.find((x) => x.id === id)!;
      expect(row.status).toBe("completed");
      expect(row.endedByTeacher).toBe(true);
      expect(row.completedAt).toBeTruthy();
    }
    expect(rows.find((x) => x.id === done.id)!.endedByTeacher).toBe(false);
    const evs = await db.select().from(schema.pedagogicalEvents).where(eq(schema.pedagogicalEvents.eventType, "ended_by_teacher"));
    expect(evs.map((e) => e.sessionId).sort()).toEqual([s1.id, s2.id].sort());
    const snap = await call("GET", `/api/live/${activity.id}`, { cookie: t.cookie });
    expect(snap.body.totals.completed).toBe(3);
  });

  it("isolates workspaces: another teacher gets 404 on every live endpoint", async () => {
    const { t, classroomId, activity } = await setup();
    const s = await insertStudent(classroomId, "Lola Paz");
    const session = await insertSession(activity.id, s.id);
    const alert = await insertAlert(session);
    const other = await newTeacher();
    expect((await call("GET", `/api/live/${activity.id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("GET", `/api/live/${activity.id}/stream`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("PATCH", `/api/live/${activity.id}/alerts/${alert.id}`, { cookie: other.cookie, body: { status: "reviewed" } })).status).toBe(404);
    expect((await call("POST", `/api/live/${activity.id}/end-all`, { cookie: other.cookie, body: { confirm: true } })).status).toBe(404);
    expect((await call("GET", `/api/live/not-a-uuid`, { cookie: t.cookie })).status).toBe(404);
    expect((await call("GET", `/api/live/${activity.id}`)).status).toBe(401);
    const [row] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, session.id));
    expect(row!.status).toBe("in_progress");
  });
});

describe("live stream (SSE)", () => {
  it("emits a change event after publish() and stops cleanly when the client leaves", async () => {
    const { t, classroomId, activity } = await setup();
    const s = await insertStudent(classroomId, "Mora Paz");
    const session = await insertSession(activity.id, s.id);
    const res = await app.request(`/api/live/${activity.id}/stream`, { headers: { cookie: t.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (needle: string, ms: number) => {
      const deadline = Date.now() + ms;
      while (!buffer.includes(needle)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timeout waiting for ${needle}; got: ${buffer}`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), left)),
        ]);
        if (chunk.done) {
          if (Date.now() >= deadline) throw new Error(`timeout waiting for ${needle}; got: ${buffer}`);
          throw new Error(`stream ended before ${needle}`);
        }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    await readUntil("event: ready", 3000);
    publish(activity.id, "message", session.id);
    publish(activity.id, "session", session.id);
    await readUntil("event: change", 3000);
    const data = buffer.split("event: change\n")[1]!.split("\n")[0]!.replace(/^data: /, "");
    const payload = JSON.parse(data);
    expect(payload.sessionIds).toEqual([session.id]);
    expect(payload.types.sort()).toEqual(["message", "session"]);
    // Both publications were coalesced into one event.
    expect(buffer.match(/event: change/g)).toHaveLength(1);
    await reader.cancel();
  });
});
