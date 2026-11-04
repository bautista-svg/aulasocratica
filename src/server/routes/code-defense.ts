// /api/code-defense — «Defensa de código» for the teacher: load each student's code and read, fragment
// by fragment, what they could explain. Reading is open to everyone with access to the classroom.
import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { badRequest, notFound, readJson } from "../lib/errors";
import { isUuid, ownedActivity, requireRole } from "../services/access";
import { audit } from "../services/audit";
import { materialCode, readCodeFiles, saveCode, studentCode } from "../services/student/code";
import { cleanCodeFiles, defenseResult, lineCount, type DefenseVerdict, type QuestionKind } from "@shared/domain/code-defense";
import { nameKey, tidyName } from "@shared/domain/names";
import { teacherCodeBody, type DefenseResponse, type DefenseStudentRow, type StudentCodeResponse } from "@shared/contracts/code-defense";

export const codeDefenseRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/:activityId", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    const [students, sessions, codes] = await Promise.all([
      db.select().from(schema.students).where(eq(schema.students.classroomId, activity.classroomId)).orderBy(asc(schema.students.fullName)),
      db.select().from(schema.learningSessions).where(eq(schema.learningSessions.activityId, activity.id)),
      db.select().from(schema.activityStudentCode).where(eq(schema.activityStudentCode.activityId, activity.id)),
    ]);
    const sessionIds = sessions.map((s) => s.id);
    const [checks, signals] = sessionIds.length
      ? await Promise.all([
          db.select().from(schema.codeDefenseChecks).where(inArray(schema.codeDefenseChecks.sessionId, sessionIds)).orderBy(asc(schema.codeDefenseChecks.createdAt)),
          db
            .select({ sessionId: schema.pedagogicalEvents.sessionId, type: schema.pedagogicalEvents.eventType, n: sql<number>`count(*)::int` })
            .from(schema.pedagogicalEvents)
            .where(and(inArray(schema.pedagogicalEvents.sessionId, sessionIds), inArray(schema.pedagogicalEvents.eventType, ["pasted_text", "left_app"])))
            .groupBy(schema.pedagogicalEvents.sessionId, schema.pedagogicalEvents.eventType),
        ])
      : [[], []];
    const sessionOf = new Map(sessions.map((s) => [s.studentId, s]));
    const codeOf = new Map(codes.map((r) => [r.studentId, r]));
    const rows: DefenseStudentRow[] = students.flatMap((st) => {
      const session = sessionOf.get(st.id);
      const code = codeOf.get(st.id);
      // Everyone in the classroom would be noise: those with code or work here.
      if (!session && !code) return [];
      const own = session ? checks.filter((k) => k.sessionId === session.id) : [];
      const signal = (type: string) => signals.find((x) => x.sessionId === session?.id && x.type === type)?.n ?? 0;
      return [
        {
          studentId: st.id,
          name: st.fullName,
          division: st.division,
          sessionId: session?.id ?? null,
          status: !session ? "waiting" : session.status === "completed" || session.tutorAchievedAt ? "done" : "working",
          code: readCodeFiles(code?.files).map((f) => ({ name: f.name, lines: lineCount(f.text), uploadedBy: code!.uploadedBy === "teacher" ? "teacher" : "student" })),
          checks: own.map((k) => ({
            id: k.id,
            file: k.file,
            fromLine: k.fromLine,
            code: k.code,
            kind: k.kind as QuestionKind,
            change: (k.change as { before: string; after: string } | null) ?? null,
            question: k.question,
            attempts: k.attempts,
            answer: k.answer,
            verdict: k.verdict as DefenseVerdict | null,
            reason: k.reason,
            quote: k.quote,
          })),
          ...defenseResult(own.map((k) => k.verdict as DefenseVerdict | null)),
          pastes: signal("pasted_text"),
          leftApp: signal("left_app"),
        },
      ];
    });
    const body: DefenseResponse = { sharedCode: (await materialCode(activity)).length > 0, students: rows };
    return c.json(body);
  })

  // Loads the code of a student by name (a new one joins the classroom, like «Cargar alumnos»).
  .put("/:activityId/code", async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    requireRole(activity, "edit");
    const body = await readJson(c, teacherCodeBody);
    const { files, error } = cleanCodeFiles(body.files);
    if (error) throw badRequest(error);
    const key = nameKey(body.studentName);
    await db
      .insert(schema.students)
      .values({ classroomId: activity.classroomId, fullName: tidyName(body.studentName), nameKey: key, selfRegistered: false })
      .onConflictDoNothing();
    const [student] = await db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(and(eq(schema.students.classroomId, activity.classroomId), eq(schema.students.nameKey, key)));
    await saveCode(activity.id, student!.id, files, "teacher");
    await audit(c, t.id, "code_defense_code_loaded", "activity", activity.id, { files: files.length });
    return c.json({ ok: true, studentId: student!.id });
  })

  .get("/:activityId/students/:studentId/code", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    const studentId = c.req.param("studentId");
    if (!isUuid(studentId)) throw notFound("El alumno");
    const [student] = await db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(and(eq(schema.students.id, studentId), eq(schema.students.classroomId, activity.classroomId)));
    if (!student) throw notFound("El alumno");
    const body: StudentCodeResponse = { files: await studentCode(activity.id, student.id) };
    return c.json(body);
  });
