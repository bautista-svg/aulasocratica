// Measures with the REAL API how much of the tutor's prompt is read from the prompt cache, turn
// after turn, with the current request layout (tutorRequest) and with the previous one (student
// state in the system prompt, no mark on the history). Same conversation, same model and
// settings as the tutor; each run uses its own activity title so one run never warms the
// other's cache. Costs a few cents.
//   npx tsx --env-file=.env scripts/dev/ai-cache-check.ts
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "../../src/server/ai/client";
import { TUTOR_MAX_TOKENS } from "../../src/server/services/student/tutor";
import { buildTutorPrompt, conversationQuery, tutorRequest, type HistoryTurn, type TutorPromptInput } from "../../src/shared/domain/tutor-prompt";
import { costUsd } from "../../src/shared/domain/ai-cost";

const MATERIAL = `Esparta y Atenas fueron las dos ciudades-estado más poderosas de la antigua Grecia, pero organizaron su vida de maneras muy distintas.
Esparta estaba en el Peloponeso. Hacia el año 715 a. C. conquistó la región vecina de Mesenia y obligó a sus habitantes a convertirse en ilotas: esclavos que trabajaban la tierra y entregaban a los espartanos la mitad de sus cosechas. Los ilotas se rebelaron muchas veces y, aunque eran muchos más que los espartanos, las revueltas fueron aplastadas. El miedo a nuevas rebeliones llevó a Esparta a organizarse alrededor de un ejército muy fuerte.
El gobierno espartano mezclaba monarquía, oligarquía y democracia. Dos reyes gobernaban juntos y comandaban el ejército. Cinco éforos, elegidos cada año, controlaban el gobierno. El Consejo de Ancianos, formado por treinta ciudadanos mayores, proponía las leyes, y la Asamblea de todos los ciudadanos varones las aprobaba o rechazaba y elegía a los funcionarios.
La sociedad espartana tenía tres grupos. Los ciudadanos vivían en la ciudad y dedicaban toda su vida a entrenarse como soldados: desde los siete años los varones vivían en barracas. Los periecos eran libres pero no ciudadanos: vivían en aldeas cercanas, comerciaban y fabricaban objetos, sin derechos políticos. Los ilotas eran el grupo más bajo; su trabajo alimentaba a todos.
Atenas, en el Ática, siguió otro camino. Después de siglos de gobierno de reyes y de aristócratas, las reformas de Solón y de Clístenes abrieron la participación política. En el siglo V a. C., con Pericles, los ciudadanos varones adultos participaban directamente en la Asamblea, votaban las leyes y podían ocupar cargos que se sorteaban. Las mujeres, los extranjeros (metecos) y los esclavos no eran ciudadanos.
La educación también era distinta: en Atenas los varones aprendían a leer, escribir, música, poesía y oratoria, porque un ciudadano tenía que poder hablar en la Asamblea; en Esparta la educación buscaba formar soldados obedientes y resistentes.
En el 490 a. C. los atenienses vencieron a los persas en la batalla de Maratón. Diez años después, espartanos y atenienses lucharon juntos contra Persia, pero luego se enfrentaron en la guerra del Peloponeso (431-404 a. C.), que ganó Esparta.`;

const STUDENT = [
  "Yo creo que en Esparta mandaba un rey solo y nadie más podía opinar.",
  "Ah, eran dos reyes y además un consejo de ancianos. ¿Y la asamblea votaba?",
  "Entonces en Atenas votaban todos los ciudadanos, pero las mujeres no eran ciudadanas.",
  "Prefiero Atenas porque la gente participaba, aunque no todos podían.",
  "¿Y los ilotas podían votar en algún lado? Me parece injusto.",
  "Entonces Esparta tenía más guerreros pero Atenas más participación.",
];

type Layout = "nuevo" | "anterior";
interface Row {
  turn: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  usd: number;
}

function request(layout: Layout, input: TutorPromptInput, history: HistoryTurn[]) {
  const prompt = buildTutorPrompt(input);
  if (layout === "nuevo") return tutorRequest(prompt, history);
  // The layout before 2026-10-22: state in a second system block, plain history.
  return {
    system: [
      { type: "text" as const, text: prompt.stable, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: prompt.volatile },
    ],
    messages: history.map((t) => ({ role: t.role, content: t.content })),
  };
}

async function run(layout: Layout, material: string): Promise<Row[]> {
  const nonce = Math.random().toString(36).slice(2, 8);
  const history: HistoryTurn[] = [];
  const rows: Row[] = [];
  for (let i = 0; i < STUDENT.length; i++) {
    history.push({ role: "user", content: STUDENT[i]! });
    const input: TutorPromptInput = {
      title: `Esparta y Atenas (medición ${nonce})`,
      subject: "Historia",
      objectives: "Comparar las formas de gobierno de Esparta y Atenas.\nJustificar una opinión con datos del texto.",
      instructions: "Compará cómo se gobernaba Esparta y cómo se gobernaba Atenas. ¿En cuál te hubiera gustado vivir y por qué?",
      material,
      files: [],
      tutorType: "comprension_lectora",
      extraTutorTypes: ["pensamiento_critico"],
      helpLevel: "moderate",
      teacherRules: "",
      voiceLanguage: "off",
      requireInitialAnswer: false,
      initialAnswer: null,
      hintCount: i,
      recentConversation: conversationQuery(history, null, ""),
    };
    const req = request(layout, input, history);
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: TUTOR_MAX_TOKENS,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: req.system as Anthropic.TextBlockParam[],
      messages: req.messages as Anthropic.MessageParam[],
    });
    const reply = res.content.find((b) => b.type === "text")?.text ?? "";
    history.push({ role: "assistant", content: reply });
    const u = res.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const input_ = u.input_tokens + cacheRead + cacheWrite;
    rows.push({
      turn: i + 1,
      input: input_,
      cacheRead,
      cacheWrite,
      output: u.output_tokens,
      usd: costUsd({ inputTokens: input_, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: u.output_tokens }),
    });
  }
  return rows;
}

function print(layout: Layout, rows: Row[]) {
  console.log(`\nDiseño ${layout}`);
  console.log("turno  entrada  de caché  escrito en caché  salida  costo US$");
  for (const r of rows) {
    console.log(
      `${String(r.turn).padStart(5)}  ${String(r.input).padStart(7)}  ${String(r.cacheRead).padStart(8)}  ${String(r.cacheWrite).padStart(16)}  ${String(r.output).padStart(6)}  ${r.usd.toFixed(6)}`,
    );
  }
  const input = rows.reduce((n, r) => n + r.input, 0);
  const read = rows.reduce((n, r) => n + r.cacheRead, 0);
  const usd = rows.reduce((n, r) => n + r.usd, 0);
  console.log(`total: ${input} tokens de entrada, ${Math.round((read / Math.max(1, input)) * 100)} % leídos de la caché, US$ ${usd.toFixed(6)}`);
  return usd;
}

for (const [name, material] of [
  ["con una página de material", MATERIAL],
  ["sin material", ""],
] as const) {
  console.log(`\n=== Actividad ${name} · ${STUDENT.length} turnos · ${MODEL} ===`);
  const before = print("anterior", await run("anterior", material));
  const after = print("nuevo", await run("nuevo", material));
  console.log(`Ahorro: ${Math.round((1 - after / before) * 100)} %`);
}
process.exit(0);
