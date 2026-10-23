// Tries the "Pedidos de cambios" interviewer with the REAL model on two short conversations
// (no database, nothing saved): prints each reply, whether it is ready and the summary.
// Costs a few cents.
//   npx tsx --env-file=.env scripts/dev/interview-check.ts
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, MODEL } from "../../src/server/ai/client";
import { INTERVIEWER_SYSTEM } from "../../src/server/services/requests/prompt";

const schema = z.object({
  reply: z.string(),
  ready: z.boolean(),
  summary: z.object({ kind: z.string(), title: z.string(), screen: z.string(), today: z.string(), desired: z.string(), details: z.array(z.string()) }),
});

const CASES: { name: string; turns: string[] }[] = [
  {
    name: "vague request, needs questions",
    turns: ["quiero que los chicos puedan ver lo que les puse en la rúbrica", "al empezar la actividad, antes de hablar con el tutor. Que vean los criterios pero no los niveles"],
  },
  {
    name: "something that already exists",
    turns: ["me gustaría poder sacar la reflexión del final, a veces no la necesito"],
  },
];

for (const c of CASES) {
  console.log(`\n=== ${c.name}`);
  const history: { who: "DOCENTE" | "VOS (asistente)"; text: string }[] = [
    { who: "VOS (asistente)", text: "¡Hola! Contame qué te gustaría cambiar, agregar o qué no te está funcionando." },
  ];
  for (const turn of c.turns) {
    history.push({ who: "DOCENTE", text: turn });
    const started = Date.now();
    const res = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 3000,
      system: INTERVIEWER_SYSTEM,
      output_config: { effort: "medium", format: zodOutputFormat(schema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "CONVERSACIÓN HASTA AHORA:" },
            ...history.map((m) => ({ type: "text" as const, text: `${m.who}: ${m.text}` })),
            { type: "text", text: "Respondé al último mensaje de la docente y actualizá el resumen." },
          ],
        },
      ],
    });
    const out = res.parsed_output!;
    console.log(`DOCENTE: ${turn}`);
    console.log(`IA (${((Date.now() - started) / 1000).toFixed(1)} s, ready=${out.ready}, in=${res.usage.input_tokens} out=${res.usage.output_tokens}): ${out.reply}`);
    console.log(`  resumen: [${out.summary.kind}] ${out.summary.title} · ${out.summary.screen}\n  quiere: ${out.summary.desired}\n  detalles: ${out.summary.details.join(" | ")}`);
    history.push({ who: "VOS (asistente)", text: out.reply });
  }
}
