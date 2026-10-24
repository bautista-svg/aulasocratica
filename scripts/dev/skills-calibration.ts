// Tries the skills evaluation with the REAL model on four fixed works of a 6th-grade activity
// (no database, nothing saved): a brief answer with real progress, a student who grows with the
// tutor's questions, one who only repeats the tutor, and an autonomous one. Prints the level of
// each skill with what the AI says, to compare how demanding it is. Costs a few cents.
//   npx tsx --env-file=.env scripts/dev/skills-calibration.ts [--verbose] [--effort high] [--json out.json]
import { writeFileSync } from "node:fs";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, MODEL } from "../../src/server/ai/client";
import { settleSkill, skillsPrompt, skillsSchema } from "../../src/server/services/sessions/skills";
import { courseLabel } from "../../src/server/services/sessions/ai";
import { buildTranscript, studentTexts, type CorpusMessage } from "../../src/server/services/sessions/corpus";
import { BUILTIN_SKILLS, DEFAULT_SKILL_SETTINGS, STATUS_LABELS, type SkillDef } from "../../src/shared/domain/skills";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const EFFORT = (arg("--effort") ?? "medium") as "low" | "medium" | "high";

const CUSTOM: SkillDef[] = [
  {
    key: "c_resolucion",
    label: "Resolución de problemas",
    dimension: "cognitiva",
    custom: true,
    criteria: ["Identifica el problema o desafío.", "Propone soluciones relacionadas con el problema.", "Evalúa si sus soluciones funcionarían.", "Considera alternativas."],
  },
  {
    key: "c_cientifico",
    label: "Pensamiento científico",
    dimension: "cognitiva",
    custom: true,
    criteria: ["Relaciona características del planeta con dificultades de exploración.", "Usa datos para explicar.", "Formula hipótesis o predicciones.", "Propone cómo comprobar sus ideas."],
  },
  {
    key: "c_planificacion",
    label: "Planificación",
    dimension: "proceso",
    custom: true,
    criteria: ["Define objetivos de la misión.", "Organiza los recursos necesarios.", "Ordena etapas o pasos.", "Anticipa riesgos."],
  },
];
const SKILLS: SkillDef[] = [
  ...DEFAULT_SKILL_SETTINGS.enabled.map((key) => {
    const b = BUILTIN_SKILLS[key as keyof typeof BUILTIN_SKILLS];
    return { key, label: b.label, dimension: b.dimension, criteria: [...b.criteria], custom: false } as SkillDef;
  }),
  ...CUSTOM,
];

const HEADER = `Actividad: Misión espacial, un viaje al Sistema Solar
Consignas (el alumno las resolvió en orden; su respuesta final tiene una parte por consigna):
<<<
Consigna 1 (Comenzamos la actividad): Elegí un planeta y justificá por qué te parece una buena opción explorarlo.
Consigna 2 (Desafíos y soluciones): Identificá los desafíos que encontrarías en la misión y proponé una solución para cada uno.
>>>`;
const OBJECTIVES = "Relacionar las características de un planeta con los desafíos de explorarlo. Proponer soluciones fundamentadas. Usar la información del material.";
const MATERIAL =
  "Marte: planeta rocoso, atmósfera delgada de dióxido de carbono (no se puede respirar), temperatura media de -60 °C, agua congelada en los polos, a 225 millones de km de la Tierra en promedio; un viaje tarda entre 6 y 9 meses. Tormentas de polvo que pueden durar semanas.";
const REFLECTION_Q = "¿Qué aprendiste en esta actividad?";

type Turn = ["A" | "T", string];
interface Case {
  name: string;
  initial: string;
  turns: Turn[];
  final: string;
  reflection: string;
}

const CASES: Case[] = [
  {
    name: "Lucía · breve, con errores, con avances reales",
    initial: "elegi marte porque tiene agua",
    turns: [
      ["T", "¡Buena elección! ¿Qué sabés del agua de Marte? ¿Dónde está y cómo está?"],
      ["A", "esta congelada en los polos"],
      ["T", "Muy bien. Si el agua está congelada, ¿qué tendrían que hacer los astronautas para usarla?"],
      ["A", "tendrian que derretirla con calor"],
      ["T", "¿Y qué otros desafíos se te ocurren, pensando en la temperatura de Marte?"],
      ["A", "hace mucho frio -60 grados, nesesitan trajes calentitos"],
      ["T", "¿Y la atmósfera? El material dice que es delgada y de dióxido de carbono. ¿Qué problema traería?"],
      ["A", "no se puede respirar, llevar tanques de oxigeno"],
    ],
    final:
      "Consigna 1 (Comenzamos la actividad):\nMarte porque tiene agua congelada y esta cerca\n\nConsigna 2 (Desafíos y soluciones):\nel frio: trajes calentitos. no hay aire: tanques de oxigeno. el agua congelada: derretirla",
    reflection: "que marte es muy frio y no tiene aire para respirar",
  },
  {
    name: "Tomás · empieza flojo y crece con las preguntas",
    initial: "Marte porque es rojo y me gusta",
    turns: [
      ["T", "¿Qué te gusta de que sea rojo? ¿Hay alguna razón que tenga que ver con explorarlo?"],
      ["A", "no se, es lindo"],
      ["T", "Pensá en lo que necesitaría una misión. Mirá el material: ¿hay algo de Marte que podría ayudar a los astronautas?"],
      ["A", "tiene agua congelada en los polos"],
      ["T", "¿Y por qué eso sería útil?"],
      ["A", "porque si hay agua los astronautas pueden tomar y tambien se puede sacar oxigeno del agua, lo vi en un video. Entonces no tendrian que llevar tanta agua desde la tierra que esta re lejos"],
      ["T", "¡Qué buena conexión! ¿Cambiarías tu respuesta inicial?"],
      ["A", "si, ahora diria que conviene ir a marte porque tiene agua y eso hace que la mision sea mas facil, no porque es rojo"],
      ["T", "¿Qué desafíos tendría la misión?"],
      ["A", "el frio y que esta lejos, 225 millones de km. capaz que tarden meses en llegar entonces tienen que llevar comida para mucho tiempo"],
    ],
    final:
      "Consigna 1 (Comenzamos la actividad):\nConviene explorar Marte porque tiene agua congelada que se puede usar para tomar y para sacar oxigeno.\n\nConsigna 2 (Desafíos y soluciones):\nDesafios: el frio (trajes termicos y bases con calefaccion), la distancia (llevar comida para muchos meses)",
    reflection: "Al principio elegi marte porque era rojo pero despues me di cuenta que lo importante es el agua",
  },
  {
    name: "Joaquín · repite lo que dice el tutor",
    initial: "marte",
    turns: [
      ["T", "¿Por qué elegiste Marte?"],
      ["A", "no se"],
      ["T", "Mirá el material. Marte tiene agua congelada en los polos. ¿Eso podría servir?"],
      ["A", "si"],
      ["T", "¿Para qué podría servir el agua en una misión?"],
      ["A", "para tomar"],
      ["T", "Exacto. Otro desafío es el frío extremo, -60 °C. ¿Cómo podrían protegerse los astronautas?"],
      ["A", "con trajes"],
      ["T", "Muy bien, trajes térmicos. ¿Algún otro desafío?"],
      ["A", "no"],
    ],
    final: "Consigna 1 (Comenzamos la actividad):\nMarte tiene agua congelada en los polos\n\nConsigna 2 (Desafíos y soluciones):\nel frio, con trajes termicos",
    reflection: "",
  },
  {
    name: "Valentina · autónoma, compara y anticipa",
    initial: "Elegiría Marte, aunque dudé con Europa (la luna de Júpiter). Marte está más cerca y tiene agua congelada, entonces una misión con personas sería más posible.",
    turns: [
      ["T", "Interesante que compares con Europa. ¿Qué te hizo descartarla?"],
      ["A", "Europa capaz tiene un océano bajo el hielo, que es re interesante para buscar vida, pero está mucho más lejos y hay mucha radiación de Júpiter. Para una primera misión con personas me parece más seguro Marte. A Europa mandaría un robot."],
      ["T", "¿Qué desafíos tendrías en Marte?"],
      ["A", "Tres: el frío de -60 grados, la atmósfera de dióxido de carbono que no se respira, y la distancia. Para el frío, bases bajo tierra porque la tierra aísla. Para el aire, sacar oxígeno del hielo. Para la distancia, salir cuando Marte está más cerca de la Tierra."],
      ["T", "¿Cómo sabrías si tus soluciones funcionan antes de mandar gente?"],
      ["A", "Primero probaría todo con un robot o en un lugar parecido de la Tierra, como la Antártida que también es fría y seca. Si algo falla, cambio el plan antes. Y llevaría repuestos por las tormentas de polvo."],
    ],
    final:
      "Consigna 1 (Comenzamos la actividad):\nMarte, porque está más cerca que otros destinos y tiene agua congelada que se puede usar para beber y obtener oxígeno.\n\nConsigna 2 (Desafíos y soluciones):\nFrío extremo: bases bajo tierra. Aire irrespirable: obtener oxígeno del hielo. Distancia: viajar cuando Marte está más cerca. Tormentas de polvo: repuestos y paneles protegidos. Antes, probar todo con robots.",
    reflection: "Aprendí que elegir un planeta no es solo por lo que tiene sino por lo que podemos hacer con la tecnología de hoy. Me costó decidir entre Marte y Europa.",
  },
];

function workText(c: Case) {
  const messages: CorpusMessage[] = c.turns.map(([who, content]) => ({ role: who === "A" ? "user" : "assistant", content, intent: null }));
  const transcript = buildTranscript(messages);
  const reflection = c.reflection ? [{ key: "q1", question: REFLECTION_Q, answer: c.reflection }] : [];
  const texts = studentTexts({ initialAnswer: c.initial, finalAnswer: c.final, reflection, messages });
  const work = `TRABAJO DEL ALUMNO
<<<
Respuesta inicial: ${c.initial}

Conversación con el tutor (completa):
${transcript.text}

Respuesta final: ${c.final}

Reflexión:
${reflection.map((r) => `- ${r.question} → ${r.answer}`).join("\n") || "(sin reflexión)"}
>>>`;
  return { work, texts };
}

const course = courseLabel({ name: "6.º A", grade: "6.º grado", division: "" });
console.log(`Curso: ${course}`);
const results = await Promise.all(
  CASES.map(async (c) => {
    const { work, texts } = workText(c);
    const skills = c.reflection ? SKILLS : SKILLS.filter((s) => s.key !== "reflexion");
    const prompt = skillsPrompt({ header: HEADER, course, objectives: OBJECTIVES, material: MATERIAL, work, skills });
    const res = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: Number(arg("--max") ?? 20_000),
      system: prompt.system,
      output_config: { effort: EFFORT, format: zodOutputFormat(skillsSchema) },
      messages: [{ role: "user", content: prompt.content }],
    });
    const out = res.parsed_output!;
    const rows = skills.map((def) => {
      const ai = out.skills.find((s) => s.skill.trim() === def.key);
      const { assessment: a, dropped } = settleSkill(def, ai, texts);
      return { skill: def.label, status: a.status, said: ai?.status ?? "", repeats: ai?.repeatsTutor, analysis: ai?.analysis ?? "", evidence: a.evidence, why: a.why, improve: a.improve, suggestion: a.suggestion, quoted: !dropped };
    });
    return { name: c.name, rows, recommendations: out.recommendations, outputTokens: res.usage.output_tokens };
  }),
);

for (const r of results) {
  console.log(`\n=== ${r.name} · ${r.outputTokens} tokens de salida`);
  for (const row of r.rows) {
    const capped = row.repeats && row.said !== row.status ? `  (la IA dijo ${row.said}; repite al tutor)` : "";
    console.log(`${STATUS_LABELS[row.status].padEnd(24)} ${row.skill}${row.quoted ? "" : "  (sin cita válida)"}${capped}`);
    if (process.argv.includes("--verbose"))
      console.log(`    análisis: ${row.analysis}\n    cita: «${row.evidence}»\n    qué muestra: ${row.why}\n    para avanzar: ${row.improve}\n    sugerencia: ${row.suggestion}`);
  }
  const counts = new Map<string, number>();
  for (const row of r.rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  console.log(`  → ${[...counts].map(([k, n]) => `${STATUS_LABELS[k as keyof typeof STATUS_LABELS]}: ${n}`).join(" · ")}`);
}
const out = arg("--json");
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
