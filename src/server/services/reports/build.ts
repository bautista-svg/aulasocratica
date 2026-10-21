// Builds the observed-data snapshot of a report FROM THE DATABASE (never from numbers sent by
// the browser). Only teacher-confirmed rubric levels and teacher-validated x-ray items are
// included; AI suggestions that the teacher did not confirm never reach a report.
import { and, asc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { ownedActivity, ownedClassroom, ownedSession, ownedStudent } from "../access";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { ReportScope } from "@shared/contracts/reports";
import {
  HELP_EVENT_KEYS,
  HELP_EVENT_TYPES,
  countHelp,
  excerpt,
  formatMinutes,
  median,
  pct,
  totalHelp,
  type HelpEventType,
  type ReportData,
  type ReportKind,
  type ReportTable,
} from "@shared/domain/reports";
import { XRAY_MOMENTS, sanitizeXrayItems } from "@shared/domain/thinking-xray";
import { ALERT_CATEGORY_LABELS, type AlertCategory } from "@shared/domain/alerts";
import { confirmedRubricRows } from "./rubric";

const TZ = "America/Argentina/Buenos_Aires";
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const longDateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
export const fmtReportDate = (d: Date | string) => dateFmt.format(new Date(d));
export const fmtReportLongDate = (d: Date | string) => longDateFmt.format(new Date(d));

const ls = schema.learningSessions;
const acts = schema.activities;

export interface BuiltReport {
  title: string;
  scope: ReportScope;
  data: ReportData;
}

/** What the report covers, as ids (the label is computed when building). */
export type ScopeInput =
  | { kind: "individual"; studentId?: string; sessionId?: string }
  | { kind: "group"; classroomId?: string; activityId?: string }
  | { kind: "overview" };

export async function buildReport(teacherId: string, input: ScopeInput, now = new Date()): Promise<BuiltReport> {
  if (input.kind === "individual") return buildIndividual(teacherId, input, now);
  if (input.kind === "group") return buildGroup(teacherId, input, now);
  return buildOverview(teacherId, now);
}

/** Scope ids stored with a report, back to a build input (used by "Actualizar datos"). */
export function scopeInputOf(kind: ReportKind, scope: ReportScope): ScopeInput {
  if (kind === "individual") return { kind, ...(scope.sessionId ? { sessionId: scope.sessionId } : { studentId: scope.studentId }) };
  if (kind === "group") return { kind, ...(scope.activityId ? { activityId: scope.activityId } : { classroomId: scope.classroomId }) };
  return { kind: "overview" };
}

// ───────────────────────── Session-level loaders (individual + group) ─────────────────────────

interface SessionRow {
  id: string;
  activityId: string;
  activityTitle: string;
  activityObjectives: string;
  studentId: string;
  studentName: string;
  status: string;
  endedByTeacher: boolean;
  startedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
  initialAnswer: string | null;
  finalAnswer: string | null;
}

async function loadSessionData(teacherId: string, where: SQL, withAnswers: boolean) {
  const scoped = and(eq(acts.teacherId, teacherId), where)!;
  const [sessions, help, alerts, rubrics, xrays] = await Promise.all([
    db
      .select({
        id: ls.id,
        activityId: ls.activityId,
        activityTitle: acts.title,
        activityObjectives: acts.objectives,
        studentId: ls.studentId,
        studentName: schema.students.fullName,
        status: ls.status,
        endedByTeacher: ls.endedByTeacher,
        startedAt: ls.startedAt,
        lastActivityAt: ls.lastActivityAt,
        completedAt: ls.completedAt,
        initialAnswer: withAnswers ? ls.initialAnswer : sql<string | null>`null`,
        finalAnswer: withAnswers ? ls.finalAnswer : sql<string | null>`null`,
      })
      .from(ls)
      .innerJoin(acts, eq(acts.id, ls.activityId))
      .innerJoin(schema.students, eq(schema.students.id, ls.studentId))
      .where(scoped)
      .orderBy(asc(ls.startedAt)),
    db
      .select({ sessionId: schema.pedagogicalEvents.sessionId, eventType: schema.pedagogicalEvents.eventType, n: sql<number>`count(*)::int` })
      .from(schema.pedagogicalEvents)
      .innerJoin(ls, eq(ls.id, schema.pedagogicalEvents.sessionId))
      .innerJoin(acts, eq(acts.id, ls.activityId))
      .where(and(scoped, inArray(schema.pedagogicalEvents.eventType, HELP_EVENT_KEYS)))
      .groupBy(schema.pedagogicalEvents.sessionId, schema.pedagogicalEvents.eventType),
    db
      .select({
        sessionId: schema.studentAlerts.sessionId,
        activityId: schema.studentAlerts.activityId,
        name: schema.studentAlerts.name,
        category: schema.studentAlerts.category,
        status: schema.studentAlerts.status,
        createdAt: schema.studentAlerts.createdAt,
      })
      .from(schema.studentAlerts)
      .innerJoin(ls, eq(ls.id, schema.studentAlerts.sessionId))
      .innerJoin(acts, eq(acts.id, ls.activityId))
      .where(scoped)
      .orderBy(asc(schema.studentAlerts.createdAt)),
    db
      .select({
        sessionId: schema.rubricAssessments.sessionId,
        rubricSnapshot: schema.rubricAssessments.rubricSnapshot,
        teacherLevels: schema.rubricAssessments.teacherLevels,
        teacherComment: schema.rubricAssessments.teacherComment,
      })
      .from(schema.rubricAssessments)
      .innerJoin(ls, eq(ls.id, schema.rubricAssessments.sessionId))
      .innerJoin(acts, eq(acts.id, ls.activityId))
      .where(and(scoped, eq(schema.rubricAssessments.status, "confirmed"))),
    db
      .select({ sessionId: schema.thinkingAnalyses.sessionId, items: schema.thinkingAnalyses.items })
      .from(schema.thinkingAnalyses)
      .innerJoin(ls, eq(ls.id, schema.thinkingAnalyses.sessionId))
      .innerJoin(acts, eq(acts.id, ls.activityId))
      .where(scoped),
  ]);

  const helpBySession = new Map<string, Record<HelpEventType, number>>();
  for (const s of sessions) helpBySession.set(s.id, countHelp([]));
  for (const h of help) {
    const counts = helpBySession.get(h.sessionId);
    if (counts && h.eventType in counts) counts[h.eventType as HelpEventType] += h.n;
  }
  const xrayItems = xrays.flatMap((x) =>
    sanitizeXrayItems(x.items)
      .filter((i) => i.status === "validated")
      .map((i) => ({ sessionId: x.sessionId, item: i })),
  );
  return { sessions: sessions as SessionRow[], helpBySession, alerts, rubrics, xrayItems };
}

const sessionStatus = (s: SessionRow) => (s.status === "completed" ? (s.endedByTeacher ? "Cerrada por el docente" : "Finalizó") : "En curso");

function durationMinutes(s: SessionRow): number {
  const end = s.completedAt ?? s.lastActivityAt;
  return Math.max(0, (end.getTime() - s.startedAt.getTime()) / 60_000);
}

const categoryLabel = (c: string) => ALERT_CATEGORY_LABELS[c as AlertCategory] ?? c;
const xrayMomentLabel = (m: keyof typeof XRAY_MOMENTS) => XRAY_MOMENTS[m].title;
const xrayCategoryLabel = (m: keyof typeof XRAY_MOMENTS, c: string) => XRAY_MOMENTS[m].categories[c] ?? c;

function alertsNote(alerts: { status: string }[]): string {
  const open = alerts.filter((a) => a.status === "open").length;
  const base = "Solo alertas que el docente revisó. No se incluyen las descartadas";
  return open > 0 ? `${base} ni ${open === 1 ? "1 alerta pendiente" : `${open} alertas pendientes`} de revisión.` : `${base}.`;
}

const RUBRIC_NOTE = "Solo niveles confirmados por el docente. Las sugerencias de la IA sin confirmar no se incluyen.";
const XRAY_NOTE = "Solo interpretaciones que el docente validó. Las sugerencias sin validar no se incluyen.";

// ───────────────────────── Individual ─────────────────────────

async function buildIndividual(teacherId: string, input: { studentId?: string; sessionId?: string }, now: Date): Promise<BuiltReport> {
  let where: SQL;
  let studentName: string;
  let roomLabel: string;
  let activityTitle: string | null = null;
  const scope: ReportScope = { label: "" };
  if (input.sessionId) {
    const owned = await ownedSession(teacherId, input.sessionId);
    const room = await ownedClassroom(teacherId, owned.activity.classroomId);
    where = eq(ls.id, owned.session.id);
    studentName = owned.student.fullName;
    roomLabel = classroomLabel(room);
    activityTitle = owned.activity.title;
    scope.sessionId = owned.session.id;
    scope.studentId = owned.student.id;
    scope.classroomId = room.id;
  } else {
    const owned = await ownedStudent(teacherId, input.studentId ?? "");
    // A student belongs to one classroom: the report is scoped to that classroom only.
    where = eq(ls.studentId, owned.student.id);
    studentName = owned.student.fullName;
    roomLabel = classroomLabel(owned.classroom);
    scope.studentId = owned.student.id;
    scope.classroomId = owned.classroom.id;
  }
  const d = await loadSessionData(teacherId, where, true);
  if (d.sessions.length === 0) {
    throw badRequest(
      activityTitle
        ? "Este trabajo ya no existe."
        : `${studentName} todavía no participó en ninguna actividad de esta aula. El informe se arma con lo que hizo en las actividades.`,
    );
  }
  scope.label = [roomLabel, activityTitle, studentName].filter(Boolean).join(" · ");

  const titleOf = new Map(d.sessions.map((s) => [s.id, s.activityTitle]));
  const totals = countHelp(Array.from(d.helpBySession.values()).flatMap((h) => HELP_EVENT_KEYS.map((k) => ({ eventType: k, n: h[k] }))));
  const completed = d.sessions.filter((s) => s.status === "completed").length;
  const reviewed = d.alerts.filter((a) => a.status === "reviewed");

  const rubricRows: (string | number)[][] = [];
  for (const r of d.rubrics) {
    const rows = confirmedRubricRows(r.rubricSnapshot, r.teacherLevels);
    rows.forEach((row, i) =>
      rubricRows.push([titleOf.get(r.sessionId) ?? "", row.criterion, row.level, i === 0 ? excerpt(r.teacherComment, 400) || "—" : ""]),
    );
  }

  const tables: ReportTable[] = [
    {
      title: "Actividades",
      columns: ["Actividad", "Estado", "Ingresó", "Tiempo de trabajo", "Ayudas pedidas"],
      note: "Tiempo de trabajo: desde que entró hasta que terminó o hasta su última acción registrada.",
      rows: d.sessions.map((s) => [
        s.activityTitle,
        sessionStatus(s),
        fmtReportDate(s.startedAt),
        formatMinutes(durationMinutes(s)),
        totalHelp(d.helpBySession.get(s.id) ?? countHelp([])),
      ]),
    },
    {
      title: "Ayudas pedidas por tipo",
      columns: ["Actividad", ...HELP_EVENT_TYPES.map(([, l]) => l)],
      rows: d.sessions.map((s) => {
        const h = d.helpBySession.get(s.id) ?? countHelp([]);
        return [s.activityTitle, ...HELP_EVENT_KEYS.map((k) => h[k])];
      }),
    },
    {
      title: "Respuesta inicial y respuesta final",
      columns: ["Actividad", "Respuesta inicial", "Respuesta final"],
      note: "Fragmentos de lo que escribió el alumno (hasta 300 caracteres).",
      rows: d.sessions.map((s) => [s.activityTitle, excerpt(s.initialAnswer) || "—", excerpt(s.finalAnswer) || "—"]),
    },
    {
      title: "Objetivos de las actividades",
      columns: ["Actividad", "Objetivos"],
      rows: d.sessions.map((s) => [s.activityTitle, excerpt(s.activityObjectives, 400) || "—"]),
    },
    {
      title: "Alertas revisadas por el docente",
      columns: ["Actividad", "Alerta", "Categoría", "Fecha"],
      note: alertsNote(d.alerts),
      rows: reviewed.map((a) => [titleOf.get(a.sessionId) ?? "", a.name, categoryLabel(a.category), fmtReportDate(a.createdAt)]),
    },
    {
      title: "Rúbricas confirmadas por el docente",
      columns: ["Actividad", "Criterio", "Nivel confirmado", "Comentario del docente"],
      note: RUBRIC_NOTE,
      rows: rubricRows,
    },
    {
      title: "Radiografía del pensamiento validada por el docente",
      columns: ["Actividad", "Momento", "Aspecto", "Interpretación", "Cita del alumno"],
      note: XRAY_NOTE,
      rows: d.xrayItems.map(({ sessionId, item }) => [
        titleOf.get(sessionId) ?? "",
        xrayMomentLabel(item.moment),
        xrayCategoryLabel(item.moment, item.category),
        excerpt(item.interpretation, 600),
        `«${excerpt(item.evidence, 300)}»`,
      ]),
    },
  ];

  const data: ReportData = {
    generatedAt: now.toISOString(),
    subtitle: `${scope.label} · datos al ${fmtReportLongDate(now)}`,
    headline: [
      { label: activityTitle ? "Actividad" : "Actividades en las que participó", value: activityTitle ? 1 : d.sessions.length },
      { label: "Finalizadas", value: completed },
      { label: "Ayudas pedidas", value: totalHelp(totals) },
      { label: "Rúbricas confirmadas", value: d.rubrics.length },
    ],
    tables,
  };
  const title = `Informe individual — ${studentName}${activityTitle ? ` · ${activityTitle}` : ""}`.slice(0, 200);
  return { title, scope, data };
}

// ───────────────────────── Group ─────────────────────────

async function buildGroup(teacherId: string, input: { classroomId?: string; activityId?: string }, now: Date): Promise<BuiltReport> {
  let room: Awaited<ReturnType<typeof ownedClassroom>>;
  let activityList: { id: string; title: string; objectives: string; status: string }[];
  let where: SQL;
  const scope: ReportScope = { label: "" };
  if (input.activityId) {
    const a = await ownedActivity(teacherId, input.activityId);
    room = await ownedClassroom(teacherId, a.classroomId);
    activityList = [{ id: a.id, title: a.title, objectives: a.objectives, status: a.status }];
    where = eq(ls.activityId, a.id);
    scope.activityId = a.id;
    scope.classroomId = room.id;
  } else {
    room = await ownedClassroom(teacherId, input.classroomId ?? "");
    // Drafts never had students; they would only add empty rows.
    activityList = await db
      .select({ id: acts.id, title: acts.title, objectives: acts.objectives, status: acts.status })
      .from(acts)
      .where(
        and(
          eq(acts.classroomId, room.id),
          eq(acts.teacherId, teacherId),
          // Qualified by hand: inside a subquery Drizzle would emit an ambiguous "id".
          or(ne(acts.status, "draft"), sql`exists (select 1 from learning_sessions s where s.activity_id = activities.id)`),
        ),
      )
      .orderBy(asc(acts.createdAt));
    where = eq(acts.classroomId, room.id);
    scope.classroomId = room.id;
  }
  const roomName = classroomLabel(room);
  const single = input.activityId ? activityList[0]! : null;
  scope.label = single ? `${roomName} · ${single.title}` : roomName;

  const [d, roster] = await Promise.all([
    loadSessionData(teacherId, where, false),
    db
      .select({ id: schema.students.id, fullName: schema.students.fullName })
      .from(schema.students)
      .where(eq(schema.students.classroomId, room.id))
      .orderBy(asc(schema.students.fullName)),
  ]);

  const byActivity = new Map<string, SessionRow[]>();
  for (const a of activityList) byActivity.set(a.id, []);
  for (const s of d.sessions) byActivity.get(s.activityId)?.push(s);
  const titleOf = new Map(activityList.map((a) => [a.id, a.title]));
  const activityOfSession = new Map(d.sessions.map((s) => [s.id, s.activityId]));

  const completed = d.sessions.filter((s) => s.status === "completed").length;
  const participants = new Set(d.sessions.map((s) => s.studentId)).size;
  const allHelp = countHelp(Array.from(d.helpBySession.values()).flatMap((h) => HELP_EVENT_KEYS.map((k) => ({ eventType: k, n: h[k] }))));

  // Reviewed alerts grouped by activity + alert name.
  const alertGroups = new Map<string, { activity: string; name: string; category: string; n: number }>();
  for (const a of d.alerts.filter((x) => x.status === "reviewed")) {
    const key = `${a.activityId}|${a.name}`;
    const g = alertGroups.get(key) ?? { activity: titleOf.get(a.activityId) ?? "", name: a.name, category: categoryLabel(a.category), n: 0 };
    g.n++;
    alertGroups.set(key, g);
  }

  // Confirmed rubric levels: distribution per activity + criterion.
  const rubricDist = new Map<string, { activity: string; criterion: string; levels: Map<string, number> }>();
  for (const r of d.rubrics) {
    const activityId = activityOfSession.get(r.sessionId) ?? "";
    for (const row of confirmedRubricRows(r.rubricSnapshot, r.teacherLevels)) {
      const key = `${activityId}|${row.criterion}`;
      const g = rubricDist.get(key) ?? { activity: titleOf.get(activityId) ?? "", criterion: row.criterion, levels: new Map<string, number>() };
      g.levels.set(row.level, (g.levels.get(row.level) ?? 0) + 1);
      rubricDist.set(key, g);
    }
  }

  // Validated x-ray items counted by moment + aspect.
  const xrayDist = new Map<string, { moment: string; aspect: string; n: number; sessions: Set<string> }>();
  for (const { sessionId, item } of d.xrayItems) {
    const key = `${item.moment}|${item.category}`;
    const g = xrayDist.get(key) ?? {
      moment: xrayMomentLabel(item.moment),
      aspect: xrayCategoryLabel(item.moment, item.category),
      n: 0,
      sessions: new Set<string>(),
    };
    g.n++;
    g.sessions.add(sessionId);
    xrayDist.set(key, g);
  }

  const notEntered = activityList
    .filter((a) => a.status === "published")
    .map((a) => {
      const inside = new Set((byActivity.get(a.id) ?? []).map((s) => s.studentId));
      const missing = roster.filter((st) => !inside.has(st.id)).map((st) => st.fullName);
      const shown = missing.slice(0, 60).join(", ");
      return [a.title, missing.length, missing.length > 60 ? `${shown} y ${missing.length - 60} más` : shown || "—"] as (string | number)[];
    })
    .filter((r) => r[1] !== 0);

  const tables: ReportTable[] = [
    {
      title: "Participación por actividad",
      columns: ["Actividad", "Participantes", "Finalizaron", "% finalización", "Tiempo mediano"],
      note: "Participantes: alumnos que entraron a la actividad. Tiempo mediano de quienes la terminaron.",
      rows: activityList.map((a) => {
        const s = byActivity.get(a.id) ?? [];
        const done = s.filter((x) => x.status === "completed");
        return [a.title, s.length, done.length, pct(done.length, s.length), formatMinutes(median(done.map(durationMinutes)))];
      }),
    },
    {
      title: "Ayudas pedidas por tipo",
      columns: ["Actividad", ...HELP_EVENT_TYPES.map(([, l]) => l), "Alumnos que pidieron ayuda"],
      rows: activityList.map((a) => {
        const s = byActivity.get(a.id) ?? [];
        const h = countHelp(s.flatMap((x) => HELP_EVENT_KEYS.map((k) => ({ eventType: k, n: d.helpBySession.get(x.id)?.[k] ?? 0 }))));
        const asked = s.filter((x) => totalHelp(d.helpBySession.get(x.id) ?? countHelp([])) > 0).length;
        return [a.title, ...HELP_EVENT_KEYS.map((k) => h[k]), asked];
      }),
    },
    {
      title: "Alertas revisadas por el docente",
      columns: ["Actividad", "Alerta", "Categoría", "Cantidad"],
      note: alertsNote(d.alerts),
      rows: Array.from(alertGroups.values()).map((g) => [g.activity, g.name, g.category, g.n]),
    },
    {
      title: "Rúbricas confirmadas por el docente",
      columns: ["Actividad", "Criterio", "Distribución de niveles"],
      note: RUBRIC_NOTE,
      rows: Array.from(rubricDist.values()).map((g) => [
        g.activity,
        g.criterion,
        Array.from(g.levels.entries())
          .map(([l, n]) => `${l}: ${n}`)
          .join(" · "),
      ]),
    },
    {
      title: "Radiografía del pensamiento validada por el docente",
      columns: ["Momento", "Aspecto", "Interpretaciones validadas", "Alumnos"],
      note: XRAY_NOTE,
      rows: Array.from(xrayDist.values()).map((g) => [g.moment, g.aspect, g.n, g.sessions.size]),
    },
    {
      title: "Alumnos del aula que no ingresaron",
      columns: ["Actividad", "Cantidad", "Alumnos"],
      note: "Alumnos de la lista del aula sin trabajo en actividades publicadas.",
      rows: notEntered,
    },
    {
      title: "Objetivos de las actividades",
      columns: ["Actividad", "Objetivos"],
      rows: activityList.map((a) => [a.title, excerpt(a.objectives, 400) || "—"]),
    },
  ];

  const data: ReportData = {
    generatedAt: now.toISOString(),
    subtitle: `${scope.label} · datos al ${fmtReportLongDate(now)}`,
    headline: [
      { label: "Alumnos del aula", value: roster.length },
      { label: "Participaron", value: participants },
      { label: "Trabajos iniciados", value: d.sessions.length },
      { label: "Finalización", value: pct(completed, d.sessions.length) },
      { label: "Ayudas pedidas", value: totalHelp(allHelp) },
    ],
    tables,
  };
  const title = `Informe grupal — ${roomName}${single ? ` · ${single.title}` : ""}`.slice(0, 200);
  return { title, scope, data };
}

// ───────────────────────── Overview (all active classrooms) ─────────────────────────

interface OverviewRow {
  id: string;
  name: string;
  grade: string;
  division: string;
  students: number;
  published: number;
  sessions: number;
  completed: number;
  [key: string]: string | number;
}

async function buildOverview(teacherId: string, now: Date): Promise<BuiltReport> {
  const helpCols = HELP_EVENT_KEYS.map(
    (k) =>
      sql`(select count(*)::int from pedagogical_events pe join learning_sessions s on s.id = pe.session_id join activities a on a.id = s.activity_id
            where a.classroom_id = c.id and pe.event_type = ${k}) as ${sql.identifier(`help_${k}`)}`,
  );
  const alertCols = (Object.keys(ALERT_CATEGORY_LABELS) as AlertCategory[]).map(
    (k) =>
      sql`(select count(*)::int from student_alerts sa join activities a on a.id = sa.activity_id
            where a.classroom_id = c.id and sa.status = 'reviewed' and sa.category = ${k}) as ${sql.identifier(`alerts_${k}`)}`,
  );
  const rows = await db.execute<OverviewRow>(sql`
    select c.id, c.name, c.grade, c.division,
      (select count(*)::int from students st where st.classroom_id = c.id) as students,
      (select count(*)::int from activities a where a.classroom_id = c.id and a.status = 'published') as published,
      (select count(*)::int from learning_sessions s join activities a on a.id = s.activity_id where a.classroom_id = c.id) as sessions,
      (select count(*)::int from learning_sessions s join activities a on a.id = s.activity_id
         where a.classroom_id = c.id and s.status = 'completed') as completed,
      (select count(*)::int from rubric_assessments ra join learning_sessions s on s.id = ra.session_id join activities a on a.id = s.activity_id
         where a.classroom_id = c.id and ra.status = 'confirmed') as rubrics,
      (select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(ta.items) = 'array' then ta.items else '[]'::jsonb end) e
                            where e->>'status' = 'validated')), 0)::int
         from thinking_analyses ta join learning_sessions s on s.id = ta.session_id join activities a on a.id = s.activity_id
         where a.classroom_id = c.id) as xray,
      ${sql.join(helpCols, sql`, `)},
      ${sql.join(alertCols, sql`, `)}
    from classrooms c
    where c.teacher_id = ${teacherId} and c.is_archived = false
    order by c.name`);
  const list = Array.from(rows);
  if (list.length === 0) throw badRequest("Todavía no tenés aulas activas. Creá un aula y una actividad para tener datos.");

  const n = (r: OverviewRow, k: string) => Number(r[k] ?? 0);
  const label = (r: OverviewRow) => classroomLabel(r);
  const sum = (k: string) => list.reduce((acc, r) => acc + n(r, k), 0);
  const scope: ReportScope = { label: list.length === 1 ? "1 aula activa" : `${list.length} aulas activas` };

  const tables: ReportTable[] = [
    {
      title: "Participación por aula",
      columns: ["Aula", "Alumnos", "Actividades publicadas", "Trabajos iniciados", "Finalizaron", "% finalización"],
      rows: list.map((r) => [
        label(r),
        n(r, "students"),
        n(r, "published"),
        n(r, "sessions"),
        n(r, "completed"),
        pct(n(r, "completed"), n(r, "sessions")),
      ]),
    },
    {
      title: "Ayudas pedidas por tipo",
      columns: ["Aula", ...HELP_EVENT_TYPES.map(([, l]) => l)],
      rows: list.map((r) => [label(r), ...HELP_EVENT_KEYS.map((k) => n(r, `help_${k}`))]),
    },
    {
      title: "Alertas revisadas por el docente",
      columns: ["Aula", ...Object.values(ALERT_CATEGORY_LABELS)],
      note: "Solo alertas que el docente revisó; no se incluyen las pendientes ni las descartadas.",
      rows: list.map((r) => [label(r), ...(Object.keys(ALERT_CATEGORY_LABELS) as AlertCategory[]).map((k) => n(r, `alerts_${k}`))]),
    },
    {
      title: "Validaciones del docente",
      columns: ["Aula", "Rúbricas confirmadas", "Interpretaciones validadas"],
      note: "Cantidad de evaluaciones con rúbrica confirmadas e interpretaciones de la radiografía validadas.",
      rows: list.map((r) => [label(r), n(r, "rubrics"), n(r, "xray")]),
    },
  ];

  const data: ReportData = {
    generatedAt: now.toISOString(),
    subtitle: `${scope.label} · datos al ${fmtReportLongDate(now)}`,
    headline: [
      { label: "Aulas activas", value: list.length },
      { label: "Actividades publicadas", value: sum("published") },
      { label: "Alumnos", value: sum("students") },
      { label: "Trabajos iniciados", value: sum("sessions") },
      { label: "Finalización", value: pct(sum("completed"), sum("sessions")) },
    ],
    tables,
  };
  return { title: `Informe general de mis aulas — ${fmtReportLongDate(now)}`.slice(0, 200), scope, data };
}
