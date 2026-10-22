// DEV/TEST ONLY — never used in production. A stand-in for the Anthropic Messages API so
// UI flows that need AI can be exercised locally without a key (e.g. during audits).
// Structured requests get a minimal JSON that satisfies the requested JSON schema;
// text requests get a short Socratic-style question. Usage: node scripts/dev/fake-claude.mjs [port]
import http from "node:http";

const port = Number(process.argv[2] ?? 47999);

function sample(schema, defs, depth = 0, key = "") {
  if (!schema || depth > 8) return null;
  if (schema.$ref) return sample(defs[schema.$ref.split("/").pop()], defs, depth + 1, key);
  if (schema.anyOf) return sample(schema.anyOf.find((s) => s.type !== "null") ?? schema.anyOf[0], defs, depth + 1, key);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = sample(v, defs, depth + 1, k);
      return out;
    }
    case "array":
      return key === "detections" ? [] : [sample(schema.items, defs, depth + 1, key), sample(schema.items, defs, depth + 1, key)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      return `Texto de prueba (${key || "campo"}) generado por el simulador local de IA.`;
    default:
      return null;
  }
}

// "Fortalezas y aspectos a reforzar": varied, realistic items (the generic sample would repeat
// the first aspect), picked from the request so different students get different ones.
const ASPECT_TEXT = {
  redaccion: ["Escribe oraciones claras y ordenadas que se entienden sin releer.", "Algunas ideas quedan sueltas; le ayudaría ordenar la respuesta en pasos."],
  argumentacion: ["Da razones para su idea y las conecta con un ejemplo.", "Afirma sin explicar por qué; conviene pedirle que justifique."],
  comprension: ["Explica con sus palabras la idea central de la actividad.", "Confunde algunos conceptos centrales del tema."],
  materiales: ["Usa datos del material para apoyar lo que dice.", "No usa los datos del material, aunque tenía lo necesario."],
  ejemplos: ["Apoya sus ideas con ejemplos concretos y propios.", "Le faltan ejemplos o datos que muestren lo que afirma."],
  pensamiento_critico: ["Compara alternativas y reconoce los límites de su idea.", "Acepta la primera idea sin compararla con otras."],
  revision: ["Corrige su respuesta a partir de las preguntas del tutor.", "Mantiene su idea inicial sin revisarla."],
  dialogo: ["Responde cada pregunta del tutor y sostiene la conversación.", "Deja varias preguntas del tutor sin responder."],
  autonomia: ["Avanza con ideas propias, sin pedir pistas.", "Depende de las pistas para avanzar."],
  vocabulario: ["Usa con sentido los términos propios del tema.", "Usa poco el vocabulario específico del tema."],
  creatividad: ["Propone una solución original para el problema.", "Repite ideas del texto sin proponer las suyas."],
  reflexion: ["Puede decir qué aprendió y qué le costó.", "La reflexión final es breve y no dice qué aprendió."],
};

function aspects(keys, body) {
  const text = JSON.stringify(body.messages ?? "");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const base = h % 4;
  const at = (o) => keys[(base + o) % keys.length];
  const item = (aspect, kind) => ({ aspect, kind, observation: ASPECT_TEXT[aspect]?.[kind === "strength" ? 0 : 1] ?? "Observación de prueba.", evidence: "" });
  return { items: [item(at(0), "strength"), item(at(1), "strength"), item(at(4), "strength"), item(at(3), "reinforce"), item(at(6), "reinforce")] };
}

function reply(body) {
  const format = body.output_config?.format;
  if (format?.schema) {
    const s = format.schema;
    const defs = s.$defs ?? s.definitions ?? {};
    // The aspects request: its keys are listed in the prompt, the schema only has strings.
    const keys = s.properties?.items?.items?.properties?.aspect ? Object.keys(ASPECT_TEXT) : null;
    if (keys) return JSON.stringify(aspects(keys, body));
    return JSON.stringify(sample(s, defs));
  }
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).find?.((b) => b.type === "text")?.text ?? "";
  return `[Simulador local] Leí: «${String(text).slice(0, 80)}». ¿Qué te hace pensar eso? ¿Podrías dar un ejemplo?`;
}

const usage = { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = raw ? JSON.parse(raw) : {};
      const text = reply(body);
      const msg = { id: "msg_fake", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage };
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(msg));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      send("message_start", { type: "message_start", message: { ...msg, content: [] } });
      send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      for (const piece of text.match(/.{1,6}/gs) ?? []) {
        send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
        await new Promise((r) => setTimeout(r, 25));
      }
      send("content_block_stop", { type: "content_block_stop", index: 0 });
      send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 30 } });
      send("message_stop", { type: "message_stop" });
      res.end();
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`fake-claude on :${port} (DEV ONLY)`));
