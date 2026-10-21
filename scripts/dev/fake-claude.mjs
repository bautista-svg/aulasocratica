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

function reply(body) {
  const format = body.output_config?.format;
  if (format?.schema) {
    const s = format.schema;
    return JSON.stringify(sample(s, s.$defs ?? s.definitions ?? {}));
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
