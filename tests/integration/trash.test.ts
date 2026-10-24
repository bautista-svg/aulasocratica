import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@server/db/client";
import { runRetention } from "@server/services/retention";
import { call, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertFullWork, insertStudent } from "./live-fixtures";

async function setup() {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie, "6.º A");
  const activity = await insertActivity(t.id, classroomId, { title: "Misión espacial" });
  const student = await insertStudent(classroomId, "Ana Gómez");
  const work = await insertFullWork(activity.id, student.id);
  await db.insert(schema.studentAlerts).values({
    sessionId: work.id,
    activityId: activity.id,
    alertKey: "stuck",
    name: "Se trabó",
    category: "academica",
    severity: "review",
  });
  return { t, classroomId, activity, student, work };
}

const titles = (r: { body: { activities: { title: string }[] } }) => r.body.activities.map((a) => a.title);

describe("deleting an activity (to the classroom's «Papelera»)", () => {
  it("hides it everywhere and closes the link, keeps the students' work, and can be restored as a draft", async () => {
    const { t, classroomId, activity, student, work } = await setup();
    expect((await call("GET", "/api/alerts/count", { cookie: t.cookie })).body.open).toBe(1);

    const trashed = await call("POST", `/api/activities/${activity.id}/trash`, { cookie: t.cookie });
    expect(trashed.status).toBe(200);
    expect(titles(await call("GET", `/api/classrooms/${classroomId}/activities`, { cookie: t.cookie }))).toEqual([]);
    const trash = await call("GET", `/api/classrooms/${classroomId}/trash`, { cookie: t.cookie });
    expect(trash.body.activities).toEqual([expect.objectContaining({ id: activity.id, title: "Misión espacial", participants: 1 })]);
    expect(new Date(trash.body.activities[0].purgeAt).getTime() - new Date(trash.body.activities[0].deletedAt).getTime()).toBe(30 * 86_400_000);
    // Students can no longer enter; its alerts and works stop showing.
    expect((await call("GET", `/api/s/${activity.linkToken}`)).body.availability ?? "closed").not.toBe("open");
    expect((await call("GET", "/api/alerts/count", { cookie: t.cookie })).body.open).toBe(0);
    expect((await call("GET", `/api/students/${student.id}`, { cookie: t.cookie })).body.works).toEqual([]);
    // Nothing of the work was deleted.
    expect(await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, work.id))).toHaveLength(1);
    // The editor knows it is in the trash; "Restaurar" (archive) does not take it out.
    const opened = await call("GET", `/api/activities/${activity.id}`, { cookie: t.cookie });
    expect(opened.body.activity).toMatchObject({ status: "archived", deletedAt: expect.any(String) });
    expect((await call("POST", `/api/activities/${activity.id}/restore`, { cookie: t.cookie })).status).toBe(400);

    const back = await call("POST", `/api/activities/${activity.id}/untrash`, { cookie: t.cookie });
    expect(back.status).toBe(200);
    expect(back.body.activity).toMatchObject({ status: "draft", deletedAt: null });
    expect(titles(await call("GET", `/api/classrooms/${classroomId}/activities`, { cookie: t.cookie }))).toEqual(["Misión espacial"]);
    expect((await call("GET", `/api/classrooms/${classroomId}/trash`, { cookie: t.cookie })).body.activities).toEqual([]);
    expect((await call("GET", "/api/alerts/count", { cookie: t.cookie })).body.open).toBe(1);

    const other = await newTeacher();
    expect((await call("POST", `/api/activities/${activity.id}/trash`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("GET", `/api/classrooms/${classroomId}/trash`, { cookie: other.cookie })).status).toBe(404);
  });

  it("is removed for good after 30 days in the trash, and can be removed earlier by hand", async () => {
    const { t, classroomId, activity } = await setup();
    const second = await insertActivity(t.id, classroomId, { title: "Otra" });
    await call("POST", `/api/activities/${activity.id}/trash`, { cookie: t.cookie });
    await call("POST", `/api/activities/${second.id}/trash`, { cookie: t.cookie });

    await db.update(schema.activities).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.activities.id, activity.id));
    await runRetention();
    expect(await db.select().from(schema.activities).where(eq(schema.activities.id, activity.id))).toHaveLength(0);
    expect(titles(await call("GET", `/api/classrooms/${classroomId}/trash`, { cookie: t.cookie }))).toEqual(["Otra"]);

    expect((await call("DELETE", `/api/activities/${second.id}`, { cookie: t.cookie, body: { confirm: "BORRAR" } })).status).toBe(200);
    expect((await call("GET", `/api/classrooms/${classroomId}/trash`, { cookie: t.cookie })).body.activities).toEqual([]);
  });
});
