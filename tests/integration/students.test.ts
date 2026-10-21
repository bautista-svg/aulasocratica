import { describe, expect, it } from "vitest";
import { call, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertAlert, insertFullWork, insertSession, insertStudent } from "./live-fixtures";

describe("student page", () => {
  it("lists the student's works in their classroom's activities and the ones not joined yet", async () => {
    const t = await newTeacher();
    const classroomId = await newClassroom(t.cookie, "5.º B");
    const a1 = await insertActivity(t.id, classroomId, { title: "Fotosíntesis" });
    const a2 = await insertActivity(t.id, classroomId, { title: "Respiración", requireInitialAnswer: false });
    await insertActivity(t.id, classroomId, { title: "Ecosistemas" });
    await insertActivity(t.id, classroomId, { title: "Borrador", status: "draft" });
    const ana = await insertStudent(classroomId, "Ana Gómez");
    const beto = await insertStudent(classroomId, "Beto Ruiz");
    const done = await insertFullWork(a1.id, ana.id);
    await insertAlert(done, { severity: "immediate", alertKey: "safety_signal", name: "Señal de seguridad", category: "seguridad" });
    await insertAlert(done, { status: "reviewed" });
    await insertSession(a2.id, ana.id, { lastActivityAt: new Date() });
    await insertSession(a1.id, beto.id, { initialAnswer: "Otra cosa" });

    const r = await call("GET", `/api/students/${ana.id}`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.student.fullName).toBe("Ana Gómez");
    expect(r.body.classroom.name).toBe("5.º B");
    expect(r.body.works.map((w: { activityTitle: string }) => w.activityTitle)).toEqual(["Respiración", "Fotosíntesis"]);
    const foto = r.body.works[1];
    expect(foto).toMatchObject({ status: "completed", openAlerts: 1, immediateAlerts: 1, totalAlerts: 2, requireInitialAnswer: true });
    expect(foto.initialAnswerPreview).toContain("las plantas usan la luz");
    expect(r.body.works[0]).toMatchObject({ status: "in_progress", initialAnswerPreview: null, requireInitialAnswer: false });
    expect(r.body.notJoined.map((a: { title: string }) => a.title)).toEqual(["Ecosistemas"]);

    expect((await call("GET", `/api/students/${ana.id}`, { cookie: (await newTeacher()).cookie })).status).toBe(404);
    expect((await call("GET", `/api/students/no-es-un-id`, { cookie: t.cookie })).status).toBe(404);
  });
});
