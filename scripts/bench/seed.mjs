// BENCHMARK ONLY — never run against a real database. Fills a dedicated database with a
// realistic, deterministic volume of data so database costs become visible:
//   main workspace: 30 classrooms, 900 students, 120 activities, 3,000 learning sessions,
//   ~60,000 messages, ~120,000 pedagogical events, ~1,800 student alerts, rubric/x-ray/summary rows,
//   activity reading material of 2,000–9,000 characters (the editor allows 20,000);
//   plus 9 other workspaces at one third of that volume each (multi-tenant tables).
// The same seed (PRNG) always produces the same ids, names and texts; timestamps are relative to
// "now" so the live activity really is live. It applies the migrations in drizzle/ first and
// TRUNCATES every table of the target database.
// Usage: DATABASE_URL=postgres://…/aula_perf node scripts/bench/seed.mjs [--out data-perf/seed-info.json]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const dbName = new URL(url).pathname.slice(1);
// Refuse the shared databases of this machine: the seed truncates everything.
if (!/perf|bench/.test(dbName)) throw new Error(`Refusing to seed "${dbName}": use a database whose name contains "perf" or "bench".`);
const outArg = process.argv.indexOf("--out");
const outFile = outArg > 0 ? process.argv[outArg + 1] : "data-perf/seed-info.json";

const sql = postgres(url, { max: 4, onnotice: () => {} });

// ── Deterministic PRNG ──
let state = 0x5eed1234;
function rnd() {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;
const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (n) => Array.from({ length: n }, () => CODE[Math.floor(rnd() * CODE.length)]).join("");
const token = (n = 43) => Array.from({ length: n }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(rnd() * 64)]).join("");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms) => new Date(ms).toISOString();

// ── Texts ──
const FIRST = ["Sofía", "Mateo", "Valentina", "Benjamín", "Martina", "Joaquín", "Catalina", "Thiago", "Emma", "Santino", "Isabella", "Bautista", "Mía", "Felipe", "Julieta", "Lautaro", "Lucía", "Tomás", "Delfina", "Juan Cruz", "Renata", "Ignacio", "Olivia", "Facundo", "Camila", "Agustín", "Pilar", "Bruno", "Abril", "Lorenzo"];
const LAST = ["González", "Rodríguez", "Gómez", "Fernández", "López", "Díaz", "Martínez", "Pérez", "García", "Sánchez", "Romero", "Sosa", "Torres", "Álvarez", "Ruiz", "Ramírez", "Flores", "Benítez", "Acosta", "Medina", "Herrera", "Aguirre", "Pereyra", "Gutiérrez", "Giménez", "Molina", "Silva", "Castro", "Rojas", "Ortiz"];
const SUBJECTS = ["Ciencias Naturales", "Historia", "Lengua y Literatura", "Matemática", "Geografía", "Formación Ética", "Biología", "Física"];
const TOPICS = ["la fotosíntesis", "la Revolución de Mayo", "el cuento fantástico", "las fracciones equivalentes", "los climas de Argentina", "los derechos del niño", "la célula", "el movimiento rectilíneo", "el ciclo del agua", "la independencia", "la argumentación", "las proporciones"];
const STUDENT_LINES = [
  "Creo que es porque la planta necesita luz para fabricar su alimento, pero no estoy seguro de cómo lo hace.",
  "No entiendo bien la consigna, ¿hay que explicar con nuestras palabras o copiar del texto?",
  "Para mí la causa principal fue económica, porque los comerciantes querían comerciar libremente.",
  "Pensé que eran iguales porque se ven parecidas, pero ahora veo que una es el doble de la otra.",
  "Me parece que el personaje cambia al final porque se da cuenta de que estaba equivocado.",
  "Si multiplico arriba y abajo por el mismo número la fracción no cambia, eso lo vimos en clase.",
  "Capaz que depende de la altura, porque en la montaña hace más frío aunque esté cerca del ecuador.",
  "No sé, me cuesta, ¿me das una pista?",
  "Ah, entonces lo que importa es la relación entre las partes y no los números sueltos.",
  "Mi respuesta cambió: antes decía que era solo por el sol, ahora agrego el agua y el dióxido de carbono.",
  "Porque si no hubiera agua las raíces no podrían absorber los nutrientes del suelo.",
  "Yo lo relaciono con lo que leímos la semana pasada sobre el cabildo abierto.",
];
const TUTOR_LINES = [
  "Buena idea empezar por la luz. ¿Qué otra cosa creés que la planta toma del ambiente para fabricar ese alimento?",
  "Podés usar tus palabras. ¿Qué parte del texto te pareció más importante para responder?",
  "Interesante. ¿Qué evidencia del texto te hace pensar que fue sobre todo económica?",
  "Mirá las dos fracciones con atención. ¿Qué pasa si comparás cuántas partes tomás en cada una?",
  "¿En qué momento del cuento notás ese cambio? ¿Qué hace el personaje distinto?",
  "Eso es clave. ¿Podrías dar un ejemplo con números para mostrarlo?",
  "Muy buena relación. ¿Cómo explicarías entonces que dos lugares a la misma latitud tengan climas distintos?",
  "Te doy una pista: pensá en qué necesita cualquier ser vivo para crecer. ¿Cuál de esas cosas puede venir del aire?",
  "¡Exacto! ¿Cómo lo dirías en una oración para alguien que no estuvo en la clase?",
  "Contame qué te hizo cambiar de idea. ¿Qué parte de la conversación te ayudó?",
  "¿Y qué pasaría con la planta si le faltara esa agua durante varios días?",
  "Buena conexión. ¿Qué tenían en común esos dos hechos?",
];
const MATERIAL_LINES = [
  "Las plantas verdes realizan la fotosíntesis en las hojas, donde la clorofila capta la energía de la luz.",
  "Durante el proceso toman dióxido de carbono del aire y agua del suelo, y liberan oxígeno a la atmósfera.",
  "El 25 de mayo de 1810 el Cabildo de Buenos Aires formó la Primera Junta de gobierno.",
  "Una fracción es equivalente a otra cuando representan la misma parte de un entero aunque usen números distintos.",
  "El clima de una región depende de la latitud, la altitud, la cercanía al mar y los vientos predominantes.",
  "En el cuento fantástico un hecho extraño irrumpe en la vida cotidiana y el lector duda sobre su explicación.",
  "La célula es la unidad básica de los seres vivos; algunas tienen núcleo definido y otras no.",
  "Un cuerpo se mueve con movimiento rectilíneo uniforme cuando recorre distancias iguales en tiempos iguales.",
];
function longText(chars, topic) {
  let s = `Material de lectura: ${topic}.\n\n`;
  while (s.length < chars) s += pick(MATERIAL_LINES) + (rnd() < 0.2 ? "\n\n" : " ");
  return s.slice(0, chars);
}
const INTENTS = ["message_sent", "message_sent", "message_sent", "hint_requested", "clarification_requested", "example_requested", "review_requested", "alternative_idea", "explanation_offered"];
const ALERT_DEFS = [
  ["comprehension_gap", "Brecha de comprensión", "academica", "review"],
  ["low_engagement", "Poco involucramiento", "conducta", "review"],
  ["pasted_text", "Pegó texto de afuera", "integridad", "review"],
  ["left_app", "Salió de la actividad", "integridad", "review"],
  ["socioemotional", "Señal socioemocional", "conducta", "review"],
  ["safety_signal", "Señal de seguridad", "seguridad", "immediate"],
];
const RUBRIC = [
  { id: "crit1", name: "Comprensión del concepto", description: "Explica el concepto central con sus palabras.", levels: ["En inicio", "En proceso", "Logrado", "Destacado"].map((label) => ({ label, description: "" })) },
  { id: "crit2", name: "Uso de evidencia", description: "Fundamenta con datos o fragmentos del material.", levels: ["En inicio", "En proceso", "Logrado", "Destacado"].map((label) => ({ label, description: "" })) },
];
const REFLECTION_QS = [
  { key: "discovered", question: "¿Qué descubriste durante la actividad?" },
  { key: "changed", question: "¿Qué cambiaste de tu respuesta y por qué?" },
];

// ── Row buffers ──
const T = {
  teachers: [], teacher_sessions: [], classrooms: [], students: [], activities: [], learning_sessions: [], student_tokens: [],
  messages: [], pedagogical_events: [], student_alerts: [], classroom_alerts: [], rubric_assessments: [], thinking_analyses: [],
  session_summaries: [], materials: [],
};

const info = { database: dbName, seed: "0x5eed1234", generatedAt: at(NOW), workspaces: [] };

function workspace(label, scale, { mainCookie = false } = {}) {
  const teacherId = uuid();
  const created = NOW - 200 * DAY;
  T.teachers.push({ id: teacherId, display_name: label, created_at: at(created), updated_at: at(created), last_seen_at: at(NOW - 2 * MIN) });
  const tok = token();
  T.teacher_sessions.push({ id: uuid(), teacher_id: teacherId, token_hash: sha256(tok), user_agent: "bench", created_at: at(created), last_used_at: at(NOW - MIN), expires_at: at(NOW + 300 * DAY) });
  const ws = { label, teacherId, cookie: `as_t=${tok}`, classrooms: [], activities: [], liveActivityId: null, studentLinks: [] };
  const nRooms = Math.round(30 * scale);
  let liveDone = false;
  const sessionsPerActivity = [];
  for (let r = 0; r < nRooms; r++) {
    const roomId = uuid();
    const grade = `${(r % 6) + 1}.º`;
    const division = ["A", "B", "C", "D", "E"][r % 5];
    const archived = r >= nRooms - 2 && nRooms > 5; // two archived classrooms
    const rc = NOW - (180 - r) * DAY;
    T.classrooms.push({ id: roomId, teacher_id: teacherId, name: `${pick(SUBJECTS)} ${grade} ${division}`, school: "Escuela N.º 12", subject: pick(SUBJECTS), grade, division, description: "", is_archived: archived, created_at: at(rc), updated_at: at(rc + int(1, 100) * DAY) });
    ws.classrooms.push(roomId);
    T.classroom_alerts.push({ id: uuid(), classroom_id: roomId, builtin_key: null, name: "Respuestas copiadas", description: "Respuestas iguales entre compañeros o copiadas del material.", category: "integridad", severity: "review", enabled: true, created_at: at(rc), updated_at: at(rc) });
    T.classroom_alerts.push({ id: uuid(), classroom_id: roomId, builtin_key: "low_engagement", name: "Poco involucramiento", description: "Desinterés, respuestas mínimas o ruido fuera de tema.", category: "conducta", severity: "review", enabled: r % 3 !== 0, created_at: at(rc), updated_at: at(rc) });
    // 30 students per classroom.
    const studs = [];
    for (let s = 0; s < 30; s++) {
      const name = `${FIRST[(s + r) % FIRST.length]} ${LAST[(s * 7 + r * 3) % LAST.length]}`;
      const key = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const id = uuid();
      T.students.push({ id, classroom_id: roomId, full_name: name, name_key: key, self_registered: s % 4 !== 0, created_at: at(rc + DAY) });
      studs.push(id);
    }
    // 4 activities per classroom; the 4th one of every other classroom is a draft (no sessions).
    for (let a = 0; a < 4; a++) {
      const actId = uuid();
      const draft = a === 3 && r % 2 === 1;
      const archivedAct = !draft && a === 0 && r % 6 === 0;
      const ac = rc + (a + 2) * 7 * DAY;
      const subject = pick(SUBJECTS);
      const topic = pick(TOPICS);
      const link = token(22);
      T.activities.push({
        id: actId, classroom_id: roomId, teacher_id: teacherId, title: `¿Por qué ${topic}? Actividad ${a + 1}`, subject,
        objectives: `Que los alumnos expliquen ${topic} con sus palabras.\nQue usen evidencia del material.`,
        instructions: `Leé el material sobre ${topic} y respondé: ¿cuál es la idea principal y por qué?`,
        // Teachers paste the reading text here (up to 20,000 characters): ~2,000–9,000 in the seed.
        material: longText(int(2_000, 9_000), topic), tutor_type: "pensamiento_critico", help_level: "moderate", tutor_rules: "",
        require_initial_answer: true, voice_language: "off", rubric: JSON.stringify(RUBRIC), reflection_questions: JSON.stringify(REFLECTION_QS),
        status: draft ? "draft" : archivedAct ? "archived" : "published", published_at: draft ? null : at(ac + DAY), link_token: link, link_active: true,
        starts_at: null, expires_at: null, created_at: at(ac), updated_at: at(ac + int(1, 20) * DAY),
      });
      ws.activities.push(actId);
      if (!draft) sessionsPerActivity.push({ actId, studs, link, roomArchived: archived, archivedAct });
    }
  }
  // Distribute exactly 3,000 × scale sessions over the activities that have participants.
  const target = Math.round(3000 * scale);
  const per = Math.floor(target / sessionsPerActivity.length);
  let extra = target - per * sessionsPerActivity.length;
  for (const sp of sessionsPerActivity) {
    const n = Math.min(30, per + (extra-- > 0 ? 1 : 0));
    const isLive = !liveDone && !sp.roomArchived && !sp.archivedAct && n >= 25;
    if (isLive) {
      liveDone = true;
      ws.liveActivityId = sp.actId;
      ws.liveLinkToken = sp.link;
    }
    for (let i = 0; i < n; i++) addSession(ws, sp.actId, sp.studs[i], isLive, i, sp.link);
  }
  for (let m = 0; m < Math.round(20 * scale); m++) {
    T.materials.push({ id: uuid(), teacher_id: teacherId, title: `Material ${m + 1}: ${pick(TOPICS)}`, kind: "text", body: longText(int(1_000, 6_000), pick(TOPICS)), extracted_text: "", processing_status: "ready", folder: m % 3 ? "Unidad 1" : "", created_at: at(NOW - m * DAY), updated_at: at(NOW - m * DAY) });
  }
  info.workspaces.push({ label, teacherId, scale, classrooms: ws.classrooms.length, activities: ws.activities.length, sessions: target });
  return ws;
}

function addSession(ws, activityId, studentId, live, index, link) {
  const id = uuid();
  // Live activity: students working in the last minutes. Others: spread over months.
  const startedAt = live ? NOW - int(10, 40) * MIN : NOW - int(1, 150) * DAY - int(0, 600) * MIN;
  const completed = live ? index % 5 === 4 : rnd() < 0.75;
  const nMsgs = (live ? int(14, 26) : int(8, 32)) & ~1; // even: user + assistant turns
  const nEvents = live ? int(30, 50) : int(28, 52);
  let t = startedAt;
  const step = () => (t += int(20, 90) * 1000);
  const evs = [];
  const ev = (type, details = {}, messageId = null) => evs.push({ id: uuid(), session_id: id, event_type: type, source: "observed", message_id: messageId, details: JSON.stringify(details), created_at: at(step()) });
  ev("session_entered", { resumed: false });
  ev("initial_answer_saved");
  const msgs = [];
  for (let m = 0; m < nMsgs; m++) {
    const role = m % 2 === 0 ? "user" : "assistant";
    const mid = uuid();
    const content = role === "user" ? pick(STUDENT_LINES) : pick(TUTOR_LINES);
    msgs.push({ id: mid, session_id: id, role, content, intent: role === "user" ? "free" : null, input_mode: "text", is_partial: false, created_at: at(step()) });
    if (role === "user") ev(pick(INTENTS), {}, mid);
  }
  while (evs.length < nEvents - (completed ? 4 : 0)) {
    const r = rnd();
    if (r < 0.15) ev("left_app", { away_ms: int(10_000, 300_000) });
    else if (r < 0.22) ev("pasted_text", { chars: int(20, 600), from_material: rnd() < 0.5 });
    else ev(pick(INTENTS));
  }
  if (completed) {
    ev("closing_started");
    ev("final_answer_saved");
    ev("reflection_submitted");
    ev("activity_completed");
  }
  const last = t;
  T.messages.push(...msgs);
  T.pedagogical_events.push(...evs);
  T.learning_sessions.push({
    id, activity_id: activityId, student_id: studentId, status: completed ? "completed" : "in_progress",
    initial_answer: pick(STUDENT_LINES), final_answer: completed ? pick(STUDENT_LINES) : null,
    reflection: completed ? JSON.stringify(REFLECTION_QS.map((q) => ({ ...q, answer: pick(STUDENT_LINES) }))) : null,
    hint_count: int(0, 4), resume_code: code(6), ended_by_teacher: false, started_at: at(startedAt),
    last_activity_at: at(live && !completed ? NOW - int(5, 100) * 1000 : last), completed_at: completed ? at(last) : null,
  });
  // ~60% of sessions have an alert, half of those still open.
  if (rnd() < 0.6) {
    const [key, name, category, severity] = pick(ALERT_DEFS);
    T.student_alerts.push({ id: uuid(), session_id: id, activity_id: activityId, message_id: null, classroom_alert_id: null, alert_key: key, name, category, severity, source: key === "pasted_text" || key === "left_app" ? "observed" : "chat", evidence: pick(STUDENT_LINES), reason: "Detectado en la conversación.", status: rnd() < 0.5 ? "open" : pick(["reviewed", "dismissed"]), reviewed_at: null, created_at: at(startedAt + 5 * MIN) });
  }
  if (completed && rnd() < 0.35) {
    T.rubric_assessments.push({ id: uuid(), session_id: id, rubric_snapshot: JSON.stringify(RUBRIC), ai_suggestion: JSON.stringify([{ criterionId: "crit1", levelIndex: 2, evidence: "", rationale: "Explica con sus palabras." }]), ai_generated_at: at(last), teacher_levels: JSON.stringify({ crit1: int(0, 3), crit2: int(0, 3) }), teacher_comment: "Buen trabajo.", status: rnd() < 0.6 ? "confirmed" : "suggested", confirmed_at: at(last), created_at: at(last), updated_at: at(last) });
  }
  if (completed && rnd() < 0.3) {
    const items = [
      { id: "x1", moment: "before", category: "hypothesis", interpretation: "Parte de una hipótesis sobre la luz.", evidence: "la planta necesita luz", status: "validated", edited: false },
      { id: "x2", moment: "during", category: "reformulation", interpretation: "Reformula al incorporar el agua.", evidence: "ahora agrego el agua", status: "suggested", edited: false },
      { id: "x3", moment: "after", category: "metacognition", interpretation: "Reconoce su cambio de idea.", evidence: "Mi respuesta cambió", status: "validated", edited: false },
    ];
    T.thinking_analyses.push({ id: uuid(), session_id: id, items: JSON.stringify(items), ai_generated_at: at(last), created_at: at(last), updated_at: at(last) });
  }
  if (completed && rnd() < 0.1) {
    T.session_summaries.push({ id: uuid(), session_id: id, basis: ["objectives"], content: JSON.stringify({ overview: "Trabajó con constancia.", strengths: ["Usa evidencia"], next: ["Profundizar"] }), created_at: at(last), updated_at: at(last) });
  }
  // A device token for the first students of the live activity (student page benchmarks).
  if (live && index < 5) {
    const tok = token();
    T.student_tokens.push({ id: uuid(), session_id: id, token_hash: sha256(tok), created_at: at(startedAt), expires_at: at(NOW + 20 * DAY), revoked_at: null });
    ws.studentLinks.push({ link, sessionId: id, inProgress: !completed, cookie: `as_s_${activityId.replace(/-/g, "")}=${tok}` });
  }
}

const main = workspace("Docente principal (bench)", 1, { mainCookie: true });
for (let i = 1; i <= 9; i++) workspace(`Otro espacio ${i} (bench)`, 1 / 3);

// ── Write ──
const started = Date.now();
await migrate(drizzle(sql), { migrationsFolder: path.resolve("drizzle") });
const tables = Object.keys(T);
await sql.unsafe(`truncate ${[...tables, "tutors", "activity_files", "reports", "audit_logs", "ai_usage"].map((t) => `"${t}"`).join(", ")} cascade`);
for (const table of tables) {
  const rows = T[table];
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const chunk = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    await sql`insert into ${sql(table)} ${sql(rows.slice(i, i + chunk), cols)}`;
  }
  process.stdout.write(`${table}: ${rows.length}\n`);
}

await sql.unsafe("vacuum analyze");

const counts = {};
for (const table of tables) counts[table] = (await sql.unsafe(`select count(*)::int as n from "${table}"`))[0].n;
const mainCounts = (
  await sql`select
    (select count(*)::int from learning_sessions ls join activities a on a.id = ls.activity_id where a.teacher_id = ${main.teacherId}) as sessions,
    (select count(*)::int from messages m join learning_sessions ls on ls.id = m.session_id join activities a on a.id = ls.activity_id where a.teacher_id = ${main.teacherId}) as messages,
    (select count(*)::int from pedagogical_events e join learning_sessions ls on ls.id = e.session_id join activities a on a.id = ls.activity_id where a.teacher_id = ${main.teacherId}) as events,
    (select count(*)::int from student_alerts sa join activities a on a.id = sa.activity_id where a.teacher_id = ${main.teacherId}) as alerts`
)[0];
const size = (await sql`select pg_size_pretty(pg_database_size(current_database())) as s`)[0].s;
const sampleSession = (
  await sql`select ls.id from learning_sessions ls join activities a on a.id = ls.activity_id
            where a.teacher_id = ${main.teacherId} and ls.status = 'completed' order by ls.id limit 1`
)[0].id;
const biggestRoom = (
  await sql`select a.classroom_id as id from activities a join learning_sessions ls on ls.activity_id = a.id
            join classrooms c on c.id = a.classroom_id
            where a.teacher_id = ${main.teacherId} and not c.is_archived group by a.classroom_id order by count(*) desc, a.classroom_id limit 1`
)[0].id;
Object.assign(info, {
  seconds: Math.round((Date.now() - started) / 1000),
  databaseSize: size,
  rows: counts,
  main: {
    teacherId: main.teacherId,
    cookie: main.cookie,
    mainCounts,
    classroomId: biggestRoom,
    liveActivityId: main.liveActivityId,
    liveLinkToken: main.liveLinkToken,
    sessionId: sampleSession,
    studentLinks: main.studentLinks,
  },
});
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(info, null, 2));
console.log(JSON.stringify({ seconds: info.seconds, size, counts, mainCounts }, null, 2));
await sql.end();
