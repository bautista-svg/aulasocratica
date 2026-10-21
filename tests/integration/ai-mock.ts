// Test double for the Anthropic Messages API (ONLY used by integration tests via
// ANTHROPIC_BASE_URL). Tests queue the reply the "model" should give; requests are
// recorded so tests can assert on prompts.
import http from "node:http";

export interface RecordedRequest {
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
}

type Reply =
  | { kind: "json"; value: unknown } // structured output (messages.parse)
  | { kind: "text"; text: string } // plain text (create or stream)
  | { kind: "error"; status: number; type: string; message: string };

const queue: Reply[] = [];
export const recorded: RecordedRequest[] = [];
let server: http.Server | null = null;
let fallback: ((body: Record<string, unknown>) => Reply) | null = null;

export const aiMock = {
  json(value: unknown) {
    queue.push({ kind: "json", value });
  },
  text(text: string) {
    queue.push({ kind: "text", text });
  },
  error(status: number, type = "api_error", message = "mock error") {
    queue.push({ kind: "error", status, type, message });
  },
  /** Reply used when the queue is empty (e.g. background alert detection). */
  setFallback(fn: ((body: Record<string, unknown>) => Reply) | null) {
    fallback = fn;
  },
  reset() {
    queue.length = 0;
    recorded.length = 0;
    fallback = null;
  },
  lastRequest(): RecordedRequest | undefined {
    return recorded.at(-1);
  },
};

const usage = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function nextReply(body: Record<string, unknown>): Reply {
  const r = queue.shift();
  if (r) return r;
  if (fallback) return fallback(body);
  // Default: structured requests get an empty-ish object, text requests a short sentence.
  const hasFormat = Boolean((body.output_config as { format?: unknown } | undefined)?.format);
  return hasFormat ? { kind: "json", value: { detections: [] } } : { kind: "text", text: "¿Qué pensás que pasaría si probás con otro ejemplo?" };
}

function message(text: string) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage,
  };
}

function sse(res: http.ServerResponse, text: string) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const base = message("");
  send("message_start", { type: "message_start", message: { ...base, content: [], usage: { ...usage, output_tokens: 1 } } });
  send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const piece of text.match(/.{1,12}/gs) ?? [text]) {
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
  }
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

export function startAiMock(port = 47811): Promise<void> {
  if (server) return Promise.resolve();
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      recorded.push({ body, headers: req.headers });
      const reply = nextReply(body);
      if (reply.kind === "error") {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: reply.type, message: reply.message } }));
        return;
      }
      const text = reply.kind === "json" ? JSON.stringify(reply.value) : reply.text;
      if (body.stream) return sse(res, text);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message(text)));
    });
  });
  return new Promise((resolve) => server!.listen(port, "127.0.0.1", () => resolve()));
}

export function stopAiMock(): Promise<void> {
  if (!server) return Promise.resolve();
  const s = server;
  server = null;
  return new Promise((resolve) => s.close(() => resolve()));
}
