import { describe, expect, it } from "vitest";
import { call, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertAlert, insertSession, insertStudent } from "./live-fixtures";

/** Two classrooms with one activity each, a student per activity and alerts of every kind. */
async function setup() {
  const t = await newTeacher();
  const roomA = await newClassroom(t.cookie, "5.º B");
  const roomB = await newClassroom(t.cookie, "4.º A");
  const actA = await insertActivity(t.id, roomA, { title: "Flotación" });
  const actB = await insertActivity(t.id, roomB, { title: "Fracciones" });
  const ana = await insertStudent(roomA, "Ana Gómez");
  const beto = await insertStudent(roomB, "Beto Ruiz");
  const sA = await insertSession(actA.id, ana.id);
  const sB = await insertSession(actB.id, beto.id);
  const old = new Date(Date.now() - 60 * 60_000);
  const gap = await insertAlert(sA, { createdAt: old });
  const safety = await insertAlert(sB, {
    alertKey: "safety_signal",
    name: "Señal de seguridad",
    category: "seguridad",
    severity: "immediate",
    createdAt: old,
  });
  const pasted = await insertAlert(sB, { alertKey: "pasted_text", name: "Pegó texto de afuera", category: "integridad", evidence: "" });
  const reviewed = await insertAlert(sA, { status: "reviewed", reviewedAt: new Date() });
  return { t, roomA, roomB, actA, actB, sA, sB, gap, safety, pasted, reviewed };
}

describe("alerts panel", () => {
  it("lists the open alerts of every classroom and activity, immediate ones first", async () => {
    const { t, gap, safety, pasted } = await setup();
    const r = await call("GET", "/api/alerts", { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items.map((a: { id: string }) => a.id)).toEqual([safety.id, pasted.id, gap.id]);
    expect(r.body.counts).toEqual({ open: 3, immediate: 1, reviewed: 1, dismissed: 0 });
    const first = r.body.items[0];
    expect(first).toMatchObject({ studentName: "Beto Ruiz", activityTitle: "Fracciones", classroomLabel: "4.º A", origin: "ai", severity: "immediate" });
    expect(r.body.items[1].origin).toBe("observed");
  });

  it("filters by classroom, activity, severity, origin and status", async () => {
    const { t, roomA, actB, gap, safety, pasted, reviewed } = await setup();
    const ids = (body: { items: { id: string }[] }) => body.items.map((a) => a.id);
    expect(ids((await call("GET", `/api/alerts?classroomId=${roomA}`, { cookie: t.cookie })).body)).toEqual([gap.id]);
    expect(ids((await call("GET", `/api/alerts?activityId=${actB.id}`, { cookie: t.cookie })).body)).toEqual([safety.id, pasted.id]);
    expect(ids((await call("GET", "/api/alerts?severity=immediate", { cookie: t.cookie })).body)).toEqual([safety.id]);
    expect(ids((await call("GET", "/api/alerts?origin=observed", { cookie: t.cookie })).body)).toEqual([pasted.id]);
    expect(ids((await call("GET", "/api/alerts?status=reviewed", { cookie: t.cookie })).body)).toEqual([reviewed.id]);
    const all = await call("GET", "/api/alerts?status=all", { cookie: t.cookie });
    expect(ids(all.body)).toEqual([safety.id, pasted.id, gap.id, reviewed.id]);
    // Counts follow the filters (except the status one).
    const inA = await call("GET", `/api/alerts?classroomId=${roomA}`, { cookie: t.cookie });
    expect(inA.body.counts).toEqual({ open: 1, immediate: 0, reviewed: 1, dismissed: 0 });
    expect((await call("GET", "/api/alerts?status=nope", { cookie: t.cookie })).status).toBe(400);
  });

  it("paginates with a cursor without repeating or skipping alerts", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const act = await insertActivity(t.id, room);
    const st = await insertStudent(room, "Caro Díaz");
    const s = await insertSession(act.id, st.id);
    const base = Date.now() - 3 * 60 * 60_000;
    for (let i = 0; i < 45; i++) await insertAlert(s, { createdAt: new Date(base + i * 1000) });
    const p1 = await call("GET", "/api/alerts", { cookie: t.cookie });
    expect(p1.body.items).toHaveLength(40);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await call("GET", `/api/alerts?cursor=${encodeURIComponent(p1.body.nextCursor)}`, { cookie: t.cookie });
    expect(p2.body.items).toHaveLength(5);
    expect(p2.body.nextCursor).toBeNull();
    const seen = new Set([...p1.body.items, ...p2.body.items].map((a: { id: string }) => a.id));
    expect(seen.size).toBe(45);
    expect((await call("GET", "/api/alerts?cursor=basura", { cookie: t.cookie })).status).toBe(400);
  });

  it("counts open alerts for the navigation badge", async () => {
    const { t } = await setup();
    const r = await call("GET", "/api/alerts/count", { cookie: t.cookie });
    expect(r.body).toEqual({ open: 3, immediate: 1 });
  });

  it("reviews, dismisses and reopens one alert or many; another workspace cannot touch them", async () => {
    const { t, gap, safety, pasted } = await setup();
    const one = await call("PATCH", `/api/alerts/${gap.id}`, { cookie: t.cookie, body: { status: "reviewed" } });
    expect(one.status).toBe(200);
    expect(one.body.alert).toMatchObject({ id: gap.id, status: "reviewed" });
    expect(one.body.alert.reviewedAt).toBeTruthy();

    const many = await call("POST", "/api/alerts/bulk", { cookie: t.cookie, body: { ids: [safety.id, pasted.id], status: "dismissed" } });
    expect(many.body.updated).toBe(2);
    expect((await call("GET", "/api/alerts/count", { cookie: t.cookie })).body).toEqual({ open: 0, immediate: 0 });

    const reopen = await call("PATCH", `/api/alerts/${safety.id}`, { cookie: t.cookie, body: { status: "open" } });
    expect(reopen.body.alert.reviewedAt).toBeNull();

    const other = await newTeacher();
    expect((await call("PATCH", `/api/alerts/${gap.id}`, { cookie: other.cookie, body: { status: "open" } })).status).toBe(404);
    const foreign = await call("POST", "/api/alerts/bulk", { cookie: other.cookie, body: { ids: [gap.id, pasted.id], status: "open" } });
    expect(foreign.body.updated).toBe(0);
    expect((await call("GET", "/api/alerts", { cookie: other.cookie })).body.items).toEqual([]);
    expect((await call("PATCH", "/api/alerts/no-es-un-id", { cookie: t.cookie, body: { status: "open" } })).status).toBe(404);
    expect((await call("POST", "/api/alerts/bulk", { cookie: t.cookie, body: { ids: [], status: "open" } })).status).toBe(400);
  });

  it("requires a teacher session", async () => {
    expect((await call("GET", "/api/alerts")).status).toBe(401);
  });
});
