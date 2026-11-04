// A worked example of «Defensa de código» for one account: classroom «Prueba», activity «Prueba»
// (Diseño web) with made-up students («… Demo») and their results, so a teacher can see the section
// filled before using it. Admin only. Running it again changes nothing.
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { humanCode } from "../lib/crypto";
import { notFound } from "../lib/errors";
import { nameKey } from "@shared/domain/names";
import {
  changeMarkdown,
  cutFragment,
  fragmentMarkdown,
  isCodeDefense,
  validChange,
  type CodeFile,
  type DefenseVerdict,
  type QuestionKind,
} from "@shared/domain/code-defense";

const PIZZERIA: CodeFile[] = [
  {
    name: "index.html",
    text: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pizzería Don Tito</title>
  <link rel="stylesheet" href="estilos.css">
</head>
<body>
  <header class="barra">
    <a href="#" class="logo">Don Tito</a>
    <button class="hamburguesa" aria-expanded="false" aria-controls="menu">☰</button>
    <nav id="menu" class="menu" data-abierto="false">
      <a href="#carta">Carta</a>
      <a href="#pedido">Pedí</a>
    </nav>
  </header>
  <main>
    <section id="carta" class="grilla">
      <article class="pizza destacada"><h2>Muzzarella</h2><p>$9000</p></article>
      <article class="pizza"><h2>Napolitana</h2><p>$10500</p></article>
      <article class="pizza"><h2>Fugazzeta</h2><p>$11000</p></article>
    </section>
    <form id="pedido" novalidate>
      <input type="tel" name="tel" pattern="[0-9]{10}" required placeholder="Tu teléfono">
      <button>Pedir</button>
    </form>
  </main>
  <script src="menu.js" defer></script>
</body>
</html>
`,
  },
  {
    name: "estilos.css",
    text: `:root { --rojo: #c0392b; --espacio: clamp(1rem, 2vw + .5rem, 2rem); }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; }
.barra { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; padding: var(--espacio); background: white; z-index: 10; }
.grilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--espacio); padding: var(--espacio); }
.pizza { border-radius: 12px; padding: 1rem; box-shadow: 0 2px 8px rgb(0 0 0 / .12); }
.pizza.destacada { grid-column: span 2; background: linear-gradient(135deg, var(--rojo), #e67e22); color: white; }
.menu { display: flex; gap: 1rem; }
.hamburguesa { display: none; }
@media (max-width: 600px) {
  .hamburguesa { display: block; }
  .menu { position: absolute; inset: 100% 0 auto 0; flex-direction: column; background: white; transform: translateY(-120%); transition: transform .3s ease; }
  .menu[data-abierto="true"] { transform: translateY(0); }
  .pizza.destacada { grid-column: auto; }
}
`,
  },
  {
    name: "menu.js",
    text: `const boton = document.querySelector('.hamburguesa');
const menu = document.getElementById('menu');
boton.addEventListener('click', () => {
  const abierto = menu.dataset.abierto === 'true';
  menu.dataset.abierto = String(!abierto);
  boton.setAttribute('aria-expanded', String(!abierto));
});
document.getElementById('pedido').addEventListener('submit', (e) => {
  const tel = e.target.tel;
  if (!tel.checkValidity()) { e.preventDefault(); tel.reportValidity(); }
});
`,
  },
];

interface DemoCheck {
  file: string;
  /** Start of the first line of the fragment, and how many lines it takes. */
  line: string;
  count?: number;
  kind: QuestionKind;
  change?: { before: string; after: string };
  question: string;
  answer?: string;
  verdict?: DefenseVerdict;
  reason?: string;
  quote?: string;
  attempts?: number;
}

const FLEX_MENU = { file: "menu.js", line: "boton.addEventListener", count: 5 };
const GRID = { file: "estilos.css", line: ".grilla {" };
const MOBILE_MENU = { file: "estilos.css", line: "  .menu { position", count: 2 };
const STICKY = { file: "estilos.css", line: ".barra {" };
const VALIDATE = { file: "menu.js", line: "document.getElementById('pedido')", count: 4 };
const PATTERN = { file: "index.html", line: '      <input type="tel"' };
const DEFER = { file: "index.html", line: '  <script src="menu.js"' };

const q = {
  grid: "¿Qué hace `auto-fit` con `minmax` en esta grilla?",
  gridChange: "Si cambio eso, ¿qué le pasa a la grilla en un celular?",
  menu: "¿Qué pasa, paso a paso, cuando alguien toca el botón?",
  mobile: "¿Por qué el menú queda escondido en el celular hasta que lo abrís?",
  stickyChange: "Si cambio eso, ¿qué pasa con la barra cuando bajás por la página?",
  validate: "¿Para qué está el `preventDefault` en este caso?",
  pattern: "¿Qué datos deja pasar este campo, y cuáles no?",
  defer: "¿Por qué este script lleva `defer`? ¿Qué podría pasar sin eso?",
};
const CHANGE_GRID = { before: "auto-fit", after: "3" };
const CHANGE_STICKY = { before: "position: sticky", after: "position: static" };

const STUDENTS: {
  name: string;
  division: string;
  by: "student" | "teacher";
  status: "completed" | "working" | "waiting";
  pastes?: number;
  left?: number;
  checks: DemoCheck[];
}[] = [
  {
    name: "Martina Demo",
    division: "N",
    by: "student",
    status: "completed",
    checks: [
      { ...GRID, kind: "meaning", question: q.grid, answer: "Hace que entren todas las tarjetas que se pueda según el ancho, y cada una mide por lo menos 220px. Si no entran, bajan solas, sin media query.", verdict: "explained", reason: "Explica que las columnas se acomodan solas según el ancho y el mínimo de cada tarjeta.", quote: "Si no entran, bajan solas, sin media query." },
      { ...FLEX_MENU, kind: "behavior", question: q.menu, answer: "Lee si el menú está abierto en el data-abierto, lo da vuelta y también actualiza aria-expanded para los lectores de pantalla. El CSS hace el resto con ese atributo.", verdict: "explained", reason: "Sigue el recorrido completo y conecta el JavaScript con el CSS y la accesibilidad.", quote: "El CSS hace el resto con ese atributo." },
      { ...STICKY, kind: "change", change: CHANGE_STICKY, question: q.stickyChange, answer: "La barra deja de quedar pegada arriba: se va con la página cuando bajás.", verdict: "explained", reason: "Anticipa bien el efecto del cambio.", quote: "se va con la página cuando bajás" },
      { ...MOBILE_MENU, kind: "why", question: q.mobile, answer: "Porque con transform lo mando para arriba, fuera de la pantalla. Usé transform y no display para que se pueda animar la bajada.", verdict: "explained", reason: "Justifica la decisión de usar transform por la animación.", quote: "Usé transform y no display para que se pueda animar la bajada." },
      { ...PATTERN, kind: "predict", question: q.pattern, answer: "Solo 10 números. Si ponés letras o menos números, no es válido.", verdict: "explained", reason: "Lee bien el patrón y dice qué rechaza.", quote: "Solo 10 números." },
      { ...DEFER, kind: "why", question: q.defer, answer: "Creo que es para que cargue después, pero no sé bien qué rompería.", verdict: "partial", reason: "Sabe que retrasa la ejecución, pero no relaciona con que el script busca elementos que todavía no existirían.", quote: "pero no sé bien qué rompería" },
    ],
  },
  {
    name: "Tomás Demo",
    division: "F",
    by: "student",
    status: "completed",
    pastes: 1,
    checks: [
      { ...GRID, kind: "change", change: CHANGE_GRID, question: q.gridChange, answer: "Quedarían siempre 3 columnas, aunque sea un celular, y se vería todo apretado.", verdict: "explained", reason: "Anticipa bien el problema en pantallas chicas.", quote: "Quedarían siempre 3 columnas" },
      { ...FLEX_MENU, kind: "behavior", question: q.menu, answer: "Abre y cierra el menú.", verdict: "partial", reason: "Dice el resultado general, pero no cómo funciona ni qué es data-abierto, aun con repregunta.", quote: "Abre y cierra el menú.", attempts: 2 },
      { ...MOBILE_MENU, kind: "why", question: q.mobile, answer: "Por la media query, que es para celular.", verdict: "partial", reason: "Ubica la media query, pero no explica qué esconde al menú.", quote: "Por la media query" },
      { ...VALIDATE, kind: "meaning", question: q.validate, answer: "No sé, eso lo saqué de un ejemplo.", verdict: "not_explained", reason: "Dice que no sabe para qué está.", quote: "No sé, eso lo saqué de un ejemplo." },
      { ...PATTERN, kind: "predict", question: q.pattern, answer: "Tiene que ser un teléfono de 10 números.", verdict: "explained", reason: "Lee bien el patrón.", quote: "de 10 números" },
    ],
  },
  {
    name: "Lucía Demo",
    division: "S",
    by: "student",
    status: "completed",
    pastes: 3,
    left: 2,
    checks: [
      { ...GRID, kind: "meaning", question: q.grid, answer: "repeat(auto-fit, minmax(min(100%, 220px), 1fr)) crea un diseño de cuadrícula responsivo que ajusta automáticamente el número de columnas.", verdict: "not_explained", reason: "Repite una definición general; con la repregunta no pudo decir qué pasa en su página.", quote: "ajusta automáticamente el número de columnas", attempts: 2 },
      { ...FLEX_MENU, kind: "behavior", question: q.menu, answer: "no sé", verdict: "not_explained", reason: "No pudo explicarlo.", quote: "no sé" },
      { ...STICKY, kind: "change", change: CHANGE_STICKY, question: q.stickyChange, answer: "Cambia la posición.", verdict: "not_explained", reason: "Repite lo que dice el código sin decir qué efecto tiene.", quote: "Cambia la posición." },
      { ...PATTERN, kind: "predict", question: q.pattern, answer: "Números, creo.", verdict: "partial", reason: "Se acerca, pero no dice cuántos ni qué rechaza.", quote: "Números, creo." },
      { ...DEFER, kind: "why", question: q.defer, answer: "No me acuerdo.", verdict: "not_explained", reason: "No pudo explicarlo.", quote: "No me acuerdo." },
    ],
  },
  {
    name: "Joaquín Demo",
    division: "N",
    by: "student",
    status: "working",
    checks: [
      { ...MOBILE_MENU, kind: "why", question: q.mobile, answer: "Porque está con translateY para arriba y recién baja cuando data-abierto es true.", verdict: "explained", reason: "Conecta el transform con el atributo que cambia el JavaScript.", quote: "recién baja cuando data-abierto es true" },
      { ...VALIDATE, kind: "meaning", question: q.validate },
    ],
  },
  { name: "Sofía Demo", division: "F", by: "teacher", status: "waiting", checks: [] },
];

export const DEMO_REQUEST_TITLE = "Tutor para defender el código en Diseño web";
const DEMO_NOTE =
  "¡Listo! El tutor ya no da por hecho que el alumno tiene el código a mano: le muestra el fragmento y le pregunta qué significa, qué hace y qué pasa si cambia algo. Para verlo armamos un ejemplo en Aulas › Prueba › actividad Prueba: abrí la sección «Diseño web», al lado de Avisos, y mirá qué pudo explicar cada alumno. Los alumnos que terminan en «Demo» son inventados. Para usarlo con tu curso, elegí el tutor «Defensa de autoría» en cualquier actividad: cada alumno sube su código al entrar, o lo cargás vos.";

function fragmentOf(c: DemoCheck) {
  const file = PIZZERIA.find((f) => f.name === c.file)!;
  const at = file.text.split("\n").findIndex((l) => l.startsWith(c.line));
  const fragment = at < 0 ? null : cutFragment(PIZZERIA, c.file, at + 1, at + (c.count ?? 1));
  if (!fragment) throw new Error(`demo: no está «${c.line}» en ${c.file}`);
  return fragment;
}

/** Every fragment of the example is cut from the real files; a test runs this. */
export function demoMessages(c: DemoCheck): { text: string; change: { before: string; after: string } | null; fragment: ReturnType<typeof fragmentOf> } {
  const fragment = fragmentOf(c);
  const change = c.change ? validChange(fragment, c.change) : null;
  if (c.change && !change) throw new Error(`demo: el cambio no está en ${c.file}: ${c.change.before}`);
  return { fragment, change, text: [fragmentMarkdown(fragment), change ? changeMarkdown(fragment.file, change) : "", c.question].filter(Boolean).join("\n\n") };
}
export const DEMO_CHECKS = STUDENTS.flatMap((s) => s.checks);

export async function seedWebDesignDemo(email: string) {
  const [teacher] = await db
    .select({ id: schema.teachers.id, name: schema.teachers.displayName })
    .from(schema.teachers)
    .where(sql`lower(${schema.teachers.email}) = ${email.toLowerCase()}`);
  if (!teacher) throw notFound("La cuenta con ese correo");

  const [room] = await db
    .select()
    .from(schema.classrooms)
    .where(and(eq(schema.classrooms.teacherId, teacher.id), eq(schema.classrooms.name, "Prueba"), eq(schema.classrooms.isArchived, false)));
  const classroom =
    room ??
    (await db
      .insert(schema.classrooms)
      .values({ teacherId: teacher.id, name: "Prueba", teacherName: teacher.name, grade: "5.º año", description: "Aula de ejemplo para ver la defensa de código de Diseño web." })
      .returning())[0]!;

  const existing = await db
    .select()
    .from(schema.activities)
    .where(and(eq(schema.activities.classroomId, classroom.id), eq(schema.activities.title, "Prueba")));
  const seeded = existing.find((a) => isCodeDefense(a));
  if (seeded) return { created: false, classroomId: classroom.id, activityId: seeded.id };

  const started = Date.now() - 26 * 3600_000;
  const [activity] = await db
    .insert(schema.activities)
    .values({
      classroomId: classroom.id,
      teacherId: teacher.id,
      title: "Prueba",
      subject: "Diseño web",
      objectives: "Explicar con sus palabras las partes más importantes de su sitio: qué hacen, por qué están y qué pasaría si cambiaran.",
      instructions: "Subí el código de tu sitio y respondé las preguntas del tutor. Te va a mostrar partes de tu código: no hace falta que lo tengas abierto.",
      tutorType: "defensa_autoria",
      helpLevel: "autonomous",
      requireInitialAnswer: false,
      askFinalAnswer: false,
      askReflection: false,
      deliverableMode: "off",
      status: "published",
      publishedAt: new Date(started),
      linkToken: randomBytes(12).toString("hex"),
    })
    .returning();

  for (const [i, s] of STUDENTS.entries()) {
    const [student] = await db
      .insert(schema.students)
      .values({ classroomId: classroom.id, fullName: s.name, nameKey: nameKey(s.name), division: s.division, selfRegistered: false })
      .onConflictDoUpdate({ target: [schema.students.classroomId, schema.students.nameKey], set: { division: s.division } })
      .returning();
    await db.insert(schema.activityStudentCode).values({ activityId: activity!.id, studentId: student!.id, files: PIZZERIA, uploadedBy: s.by });
    if (s.status === "waiting") continue;

    let at = started + i * 40 * 60_000;
    const tick = (minutes = 1) => new Date((at += minutes * 60_000));
    const done = s.status === "completed";
    const [session] = await db
      .insert(schema.learningSessions)
      .values({
        activityId: activity!.id,
        studentId: student!.id,
        status: done ? "completed" : "in_progress",
        resumeCode: humanCode(6),
        startedAt: new Date(at),
        lastActivityAt: new Date(done ? at + 30 * 60_000 : Date.now() - 4 * 60_000),
        completedAt: done ? new Date(at + 30 * 60_000) : null,
        tutorAchievedAt: done ? new Date(at + 29 * 60_000) : null,
      })
      .returning();
    for (const c of s.checks) {
      const m = demoMessages(c);
      const [asked] = await db.insert(schema.messages).values({ sessionId: session!.id, role: "assistant", content: m.text, createdAt: tick(2) }).returning({ id: schema.messages.id });
      await db.insert(schema.codeDefenseChecks).values({
        sessionId: session!.id,
        messageId: asked!.id,
        file: m.fragment.file,
        fromLine: m.fragment.fromLine,
        toLine: m.fragment.toLine,
        code: m.fragment.code,
        kind: c.kind,
        change: m.change,
        question: c.question,
        attempts: c.attempts ?? 1,
        answer: c.answer ?? "",
        verdict: c.verdict ?? null,
        reason: c.reason ?? "",
        quote: c.quote ?? "",
        createdAt: new Date(at),
        answeredAt: c.answer ? new Date(at + 60_000) : null,
      });
      if (c.answer) await db.insert(schema.messages).values({ sessionId: session!.id, role: "user", content: c.answer, createdAt: tick(1) });
    }
    if (done) {
      await db.insert(schema.messages).values({ sessionId: session!.id, role: "assistant", content: "Gracias, eso era todo lo que quería preguntarte. Tocá «Terminar» para cerrar la actividad.", createdAt: tick(1) });
    }
    const events = [
      ...Array.from({ length: s.pastes ?? 0 }, () => ({ sessionId: session!.id, eventType: "pasted_text", details: { chars: 140, from_material: false } })),
      ...Array.from({ length: s.left ?? 0 }, () => ({ sessionId: session!.id, eventType: "left_app", details: { away_ms: 95_000 } })),
    ];
    if (events.length) await db.insert(schema.pedagogicalEvents).values(events);
  }

  // She sees where to find it in «Pedidos de cambios», next to what she asked for before.
  const [already] = await db
    .select({ id: schema.changeRequests.id })
    .from(schema.changeRequests)
    .where(and(eq(schema.changeRequests.teacherId, teacher.id), eq(schema.changeRequests.title, DEMO_REQUEST_TITLE)));
  if (!already) {
    await db.insert(schema.changeRequests).values({
      teacherId: teacher.id,
      status: "done",
      title: DEMO_REQUEST_TITLE,
      ready: true,
      note: DEMO_NOTE,
      submittedAt: new Date(),
      resolvedAt: new Date(),
      summary: {
        kind: "change",
        title: DEMO_REQUEST_TITLE,
        screen: "Aulas → Prueba → actividad Prueba → Diseño web",
        today: "El tutor preguntaba por el código dando por hecho que el alumno lo tenía a mano.",
        desired: "Que el tutor muestre el fragmento y pregunte qué significa, qué hace y qué pasa si cambia, para ver si el alumno entiende su código.",
        details: ["Registrado por el equipo, a partir de lo que conversamos."],
      },
    });
  }
  return { created: true, classroomId: classroom.id, activityId: activity!.id };
}
