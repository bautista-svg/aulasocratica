// Direct-to-database fixtures for the live / sessions / students tests (the activities
// and student APIs belong to other modules, so rows are inserted with Drizzle).
import { randomBytes } from "node:crypto";
import { db, schema } from "@server/db/client";
import { nameKey } from "@shared/domain/names";
import type { RubricCriterion } from "@shared/domain/activity-design";

export const RUBRIC: RubricCriterion[] = [
  {
    id: "arg",
    name: "Argumentación",
    description: "Sostiene su idea con razones.",
    levels: [
      { label: "En inicio", description: "Sin razones." },
      { label: "En proceso", description: "Una razón." },
      { label: "Logrado", description: "Varias razones." },
    ],
  },
  {
    id: "evid",
    name: "Uso de evidencia",
    description: "Usa datos del material.",
    levels: [
      { label: "En inicio", description: "No usa datos." },
      { label: "Logrado", description: "Usa datos." },
    ],
  },
];

export async function insertActivity(
  teacherId: string,
  classroomId: string,
  over: Partial<typeof schema.activities.$inferInsert> = {},
) {
  const [a] = await db
    .insert(schema.activities)
    .values({
      teacherId,
      classroomId,
      title: "La fotosíntesis",
      instructions: "Explicá por qué las plantas necesitan luz.",
      objectives: "Relacionar la luz con la producción de alimento\nUsar evidencia del texto",
      status: "published",
      publishedAt: new Date(),
      linkToken: randomBytes(12).toString("hex"),
      rubric: RUBRIC,
      reflectionQuestions: [{ key: "discovered", question: "¿Qué descubriste durante la actividad?" }],
      ...over,
    })
    .returning();
  return a!;
}

export async function insertStudent(classroomId: string, fullName: string) {
  const [s] = await db.insert(schema.students).values({ classroomId, fullName, nameKey: nameKey(fullName) }).returning();
  return s!;
}

export async function insertSession(activityId: string, studentId: string, over: Partial<typeof schema.learningSessions.$inferInsert> = {}) {
  const [s] = await db
    .insert(schema.learningSessions)
    .values({ activityId, studentId, resumeCode: randomBytes(3).toString("hex").toUpperCase(), ...over })
    .returning();
  return s!;
}

export async function insertMessages(
  sessionId: string,
  list: { role: "user" | "assistant"; content: string; intent?: string | null; isPartial?: boolean; at?: Date }[],
) {
  if (!list.length) return [];
  const base = Date.now() - list.length * 1000;
  return db
    .insert(schema.messages)
    .values(
      list.map((m, i) => ({
        sessionId,
        role: m.role,
        content: m.content,
        intent: m.intent ?? null,
        isPartial: m.isPartial ?? false,
        createdAt: m.at ?? new Date(base + i * 1000),
      })),
    )
    .returning();
}

export async function insertEvents(sessionId: string, list: { type: string; at?: Date; details?: Record<string, unknown> }[]) {
  if (!list.length) return;
  await db.insert(schema.pedagogicalEvents).values(
    list.map((e, i) => ({ sessionId, eventType: e.type, createdAt: e.at ?? new Date(Date.now() - (list.length - i) * 1000), details: e.details ?? {} })),
  );
}

export async function insertAlert(
  session: { id: string; activityId: string },
  over: Partial<typeof schema.studentAlerts.$inferInsert> = {},
) {
  const [a] = await db
    .insert(schema.studentAlerts)
    .values({
      sessionId: session.id,
      activityId: session.activityId,
      alertKey: "comprehension_gap",
      name: "Brecha de comprensión",
      category: "academica",
      severity: "review",
      evidence: "no entiendo nada de esto",
      reason: "Dice que no entiende el tema.",
      ...over,
    })
    .returning();
  return a!;
}

/** A complete work: initial answer, a short conversation with a hint, final answer and reflection. */
export async function insertFullWork(activityId: string, studentId: string, over: Partial<typeof schema.learningSessions.$inferInsert> = {}) {
  const started = new Date(Date.now() - 20 * 60_000);
  const session = await insertSession(activityId, studentId, {
    initialAnswer: "Creo que las plantas usan la luz para fabricar su alimento.",
    finalAnswer: "Las plantas transforman la energía de la luz en azúcares que usan para crecer.",
    reflection: [{ key: "discovered", question: "¿Qué descubriste durante la actividad?", answer: "Que la clorofila absorbe la luz del sol." }],
    status: "completed",
    startedAt: started,
    lastActivityAt: new Date(Date.now() - 2 * 60_000),
    completedAt: new Date(Date.now() - 2 * 60_000),
    ...over,
  });
  await insertMessages(session.id, [
    { role: "assistant", content: "Buena idea para empezar. ¿Qué pasaría con una planta que vive en un placard oscuro?" },
    { role: "user", content: "Se pondría amarilla porque no puede hacer la fotosíntesis." },
    { role: "user", content: "Necesito una pista.", intent: "hint" },
    { role: "assistant", content: "Pensá en qué parte de la hoja ocurre. ¿Qué pigmento verde conocés?" },
    { role: "user", content: "Tengo otra idea: la clorofila atrapa la luz como un panel solar.", intent: "other_idea" },
  ]);
  await insertEvents(session.id, [
    { type: "session_entered", at: new Date(started.getTime() + 1000) },
    { type: "initial_answer_saved", at: new Date(started.getTime() + 60_000) },
    { type: "message_sent", at: new Date(started.getTime() + 120_000) },
    { type: "hint_requested", at: new Date(started.getTime() + 180_000) },
    { type: "pasted_text", at: new Date(started.getTime() + 200_000), details: { chars: 140 } },
    { type: "alternative_idea", at: new Date(started.getTime() + 240_000) },
    { type: "closing_started", at: new Date(started.getTime() + 300_000) },
    { type: "final_answer_saved", at: new Date(started.getTime() + 400_000) },
    { type: "activity_completed", at: new Date(started.getTime() + 401_000) },
  ]);
  return session;
}
